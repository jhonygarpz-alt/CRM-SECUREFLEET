import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createWaWebClient } from '../src/services/waweb.js';

let server;
let base;
let token;
let wa;
const sent = [];

before(async () => {
  const db = openDb(':memory:');
  wa = createWaWebClient(db, { authDir: path.join(os.tmpdir(), `waweb-test-${process.pid}`) });
  const fakeSock = {
    onWhatsApp: async (n) => [{ exists: true, jid: n.startsWith('52') && n.length === 12 ? `521${n.slice(2)}@s.whatsapp.net` : `${n}@s.whatsapp.net` }],
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: `WEB${sent.length}`, remoteJid: jid, fromMe: true } }; },
    readMessages: async () => {},
  };
  wa._setConnected(fakeSock, '527204765054');
  server = createApp(db, { wa }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@securefleet.mx', password: 'admin123' }) });
  token = (await r.json()).token;
});
after(() => server.close());

const api = async (p, { method = 'GET', body } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const now = () => Math.floor(Date.now() / 1000);

test('WhatsApp Web: mensaje entrante crea lead y se contesta sin regla de 24 h', async () => {
  const st = (await api('/whatsapp/status')).data;
  assert.equal(st.provider, 'waweb');
  assert.equal(st.requiresWindow, false);
  assert.equal(st.web.state, 'connected');

  await wa._handleUpsert({ type: 'notify', messages: [{
    key: { id: 'IN1', remoteJid: '5218111112222@s.whatsapp.net', fromMe: false },
    pushName: 'Juan Flotillas', messageTimestamp: now(), message: { conversation: 'Hola, quiero GPS' },
  }] });
  const c = (await api('/contacts?q=Juan Flotillas')).data[0];
  assert.equal(c.phone, '528111112222');
  assert.equal(c.source, 'WhatsApp');

  // Contacto sin conversación previa: en API oficial se exigiría plantilla, aquí no.
  const nuevo = (await api('/contacts', { method: 'POST', body: { name: 'Sin chat', phone: '8122223333' } })).data;
  const r = await api(`/whatsapp/conversations/${nuevo.id}/send`, { method: 'POST', body: { body: 'Hola, te escribo de SecureFleet' } });
  assert.equal(r.status, 201);
  assert.equal(sent.at(-1).jid, '5218122223333@s.whatsapp.net');
  assert.equal(sent.at(-1).content.text, 'Hola, te escribo de SecureFleet');

  // Estado leído
  await wa._handleUpdates([{ key: { id: r.data.wa_message_id, fromMe: true }, update: { status: 4 } }]);
  const msgs = (await api(`/whatsapp/conversations/${nuevo.id}`)).data.messages;
  assert.equal(msgs.at(-1).status, 'read');
});

test('WhatsApp Web: lo que contestas desde el celular aparece en el CRM, sin duplicar envíos del CRM', async () => {
  const c = (await api('/contacts?q=Juan Flotillas')).data[0];
  await wa._handleUpsert({ type: 'notify', messages: [{
    key: { id: 'PHONE1', remoteJid: '5218111112222@s.whatsapp.net', fromMe: true },
    messageTimestamp: now(), message: { extendedTextMessage: { text: 'Te mando la cotización' } },
  }] });
  // Envío desde el CRM y su eco (mismo id)
  const r = await api(`/whatsapp/conversations/${c.id}/send`, { method: 'POST', body: { body: 'Desde el CRM' } });
  await wa._handleUpsert({ type: 'append', messages: [{
    key: { id: r.data.wa_message_id, remoteJid: '5218111112222@s.whatsapp.net', fromMe: true },
    messageTimestamp: now(), message: { conversation: 'Desde el CRM' },
  }] });
  await new Promise((res) => setTimeout(res, 2300));
  const msgs = (await api(`/whatsapp/conversations/${c.id}`)).data.messages;
  assert.equal(msgs.filter((m) => m.direction === 'in').length, 1);
  assert.equal(msgs.filter((m) => m.body === 'Desde el CRM').length, 1);
  assert.equal(msgs.filter((m) => m.body === 'Te mando la cotización').length, 1);
});

test('WhatsApp Web: cotización en PDF se envía como documento; plantillas no aplican', async () => {
  const c = (await api('/contacts?q=Juan Flotillas')).data[0];
  const q = (await api('/quotes', { method: 'POST', body: { contact_id: c.id, items: [{ description: 'GPS', quantity: 2, unit_price: 1890 }] } })).data;
  assert.equal((await api(`/quotes/${q.id}/send-whatsapp`, { method: 'POST', body: {} })).status, 200);
  const doc = sent.at(-1).content;
  assert.equal(doc.mimetype, 'application/pdf');
  assert.ok(Buffer.isBuffer(doc.document));
  assert.equal((await api(`/whatsapp/conversations/${c.id}/template`, { method: 'POST', body: { name: 'x' } })).status, 400);
});
