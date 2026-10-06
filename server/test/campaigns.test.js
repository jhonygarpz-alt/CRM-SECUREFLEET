import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createWaWebClient } from '../src/services/waweb.js';
import { personalize } from '../src/services/campaigns.js';

let app;
let server;
let base;
let token;
const sent = [];

before(async () => {
  const db = openDb(':memory:');
  const wa = createWaWebClient(db, { authDir: path.join(os.tmpdir(), `camp-test-${process.pid}`) });
  wa._setConnected({
    onWhatsApp: async (n) => [{ exists: true, jid: `${n}@s.whatsapp.net` }],
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: `C${sent.length}`, remoteJid: jid, fromMe: true } }; },
    readMessages: async () => {},
  }, '527204765054');
  app = createApp(db, { wa });
  server = app.listen(0);
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

test('personaliza {nombre} y {empresa}', () => {
  assert.equal(personalize('Hola {nombre} de {empresa}', { name: 'Ricardo Pérez', company: 'Peset Trucking' }), 'Hola Ricardo de Peset Trucking');
  assert.equal(personalize('Hola {empresa}', { name: 'Ana' }), 'Hola Ana');
});

test('campaña con imagen: envía uno por uno, omite sin teléfono y respeta el límite diario', async () => {
  const ids = [];
  for (const [name, company, phone] of [['Ricardo Pérez', 'Peset Trucking', '8672991918'], ['Héctor Jiménez', 'JILO Logistics', '8442778977'],
    ['Sin Teléfono', 'X', ''], ['Laura Méndez', 'Lugan', '8135810306']]) {
    ids.push((await api('/contacts', { method: 'POST', body: { name, company, phone } })).data.id);
  }
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const c = await api('/campaigns', { method: 'POST', body: { name: 'Expo ERP', body: 'Hola {nombre}, te escribo por {empresa}', image: png,
    contact_ids: ids, min_delay: 15, max_delay: 30, daily_limit: 2 } });
  assert.equal(c.status, 201);
  assert.equal(c.data.status, 'borrador');
  assert.equal(c.data.counts.pendiente, 4);

  // En borrador no envía nada
  assert.equal(await app.locals.campaigns.tick(), null);
  await api(`/campaigns/${c.data.id}/start`, { method: 'POST' });

  const results = [];
  for (let i = 0; i < 6; i++) {
    app.locals.campaigns.resetDelay();
    results.push(await app.locals.campaigns.tick());
  }
  assert.deepEqual(results.slice(0, 4), ['enviado', 'enviado', 'omitido', 'limite']);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].content.caption, 'Hola Ricardo, te escribo por Peset Trucking');
  assert.ok(Buffer.isBuffer(sent[0].content.image));
  assert.equal(sent[1].content.caption, 'Hola Héctor, te escribo por JILO Logistics');

  const d = (await api(`/campaigns/${c.data.id}`)).data;
  assert.deepEqual(d.counts, { enviado: 2, omitido: 1, pendiente: 1 });
  assert.equal(d.sentToday, 2);
  // El mensaje queda en el chat del contacto con su imagen
  const msgs = (await api(`/whatsapp/conversations/${ids[0]}`)).data.messages;
  assert.equal(msgs.at(-1).media_mime, 'image/png');
  assert.equal((await api(`/contacts/${ids[0]}`)).data.status, 'contactado');

  // Pausar y cancelar
  assert.equal((await api(`/campaigns/${c.data.id}/pause`, { method: 'POST' })).data.status, 'pausada');
  assert.equal((await api(`/campaigns/${c.data.id}/cancel`, { method: 'POST' })).data.status, 'cancelada');
});

test('validaciones', async () => {
  assert.equal((await api('/campaigns', { method: 'POST', body: { name: 'x', body: 'y', contact_ids: [] } })).status, 400);
  assert.equal((await api('/campaigns', { method: 'POST', body: { name: '', body: 'y', contact_ids: [1] } })).status, 400);
});
