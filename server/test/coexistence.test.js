import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createDynamicWhatsAppClient } from '../src/services/whatsapp.js';

let server;
let base;
let token;
let db;
const sent = [];
const syncCalls = [];

before(async () => {
  delete process.env.WHATSAPP_APP_SECRET; // sin firma en esta prueba
  db = openDb(':memory:');
  const fetchImpl = async (url, opts) => {
    sent.push({ url, opts });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 });
  };
  const wa = createDynamicWhatsAppClient(db, { fetchImpl });
  const signup = {
    enabled: true,
    exchangeCode: async (code) => (code === 'good' ? 'TOKEN-XYZ' : Promise.reject(new Error('bad code'))),
    phoneNumbers: async () => [{ id: 'PN1', display_phone_number: '+52 720 476 5054' }],
    phoneInfo: async () => ({ display_phone_number: '+52 720 476 5054', verified_name: 'SecureFleet' }),
    subscribeApp: async () => ({ success: true }),
    requestSync: async (phoneId, tok, type) => { syncCalls.push({ phoneId, tok, type }); return { request_id: 'x' }; },
  };
  server = createApp(db, { wa, signup }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@securefleet.mx', password: 'admin123' }),
  });
  token = (await r.json()).token;
});
after(() => server.close());

const api = async (path, { method = 'GET', body, auth = true } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const hook = (value) => api('/whatsapp/webhook', { method: 'POST', auth: false, body: { entry: [{ changes: [{ value }] }] } });

test('conectar por registro integrado guarda el número sin exponer el token', async () => {
  assert.equal((await api('/whatsapp/status')).data.configured, false);
  const r = await api('/whatsapp/embedded-signup', { method: 'POST', body: { code: 'good', waba_id: 'WABA1' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.phoneNumberId, 'PN1');
  assert.deepEqual(syncCalls.map((c) => c.type), ['smb_app_state_sync', 'history']);

  const st = (await api('/whatsapp/status')).data;
  assert.equal(st.configured, true);
  assert.equal(st.coexistence, true);
  assert.equal(st.displayPhone, '+52 720 476 5054');
  const settings = (await api('/settings')).data;
  assert.ok(!Object.keys(settings).some((k) => k.startsWith('secret_')), 'el token no debe llegar al navegador');
});

test('los envíos usan el número y token conectados', async () => {
  const c = (await api('/contacts', { method: 'POST', body: { name: 'Cliente', phone: '5512340000' } })).data;
  await api(`/whatsapp/conversations/${c.id}/template`, { method: 'POST', body: { name: 'hola' } });
  const last = sent.at(-1);
  assert.match(last.url, /\/PN1\/messages$/);
  assert.equal(last.opts.headers.Authorization, 'Bearer TOKEN-XYZ');
});

test('ecos del celular e historial se guardan en la conversación', async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  await hook({ message_echoes: [{ from: '527204765054', to: '5215599990000', id: 'wamid.echo1', timestamp: ts, type: 'text', text: { body: 'Enviado desde el celular' } }] });
  await hook({ history: [{ threads: [{ id: '5215599990000', messages: [
    { from: '5215599990000', id: 'wamid.h1', timestamp: String(Number(ts) - 3600), type: 'text', text: { body: 'Hola, ¿precio?' }, history_context: { status: 'READ' } },
    { from: '527204765054', id: 'wamid.h2', timestamp: String(Number(ts) - 3500), type: 'text', text: { body: 'Te cotizo' }, history_context: { status: 'DELIVERED' } },
  ] }] }] });
  await hook({ state_sync: [{ type: 'contact', action: 'add', contact: { full_name: 'Pedro Flotillas', phone_number: '5215599990000' } }] });

  const contact = (await api('/contacts?q=5599990000')).data;
  assert.equal(contact.length, 1);
  assert.equal(contact[0].name, 'Pedro Flotillas');
  const msgs = (await api(`/whatsapp/conversations/${contact[0].id}`)).data.messages;
  assert.deepEqual(msgs.map((m) => [m.direction, m.body]), [
    ['in', 'Hola, ¿precio?'], ['out', 'Te cotizo'], ['out', 'Enviado desde el celular'],
  ]);
  assert.equal(contact[0].unread_count, 0, 'el historial no marca como no leído');
});

test('desconectar vuelve a modo simulación', async () => {
  await api('/whatsapp/disconnect', { method: 'POST' });
  assert.equal((await api('/whatsapp/status')).data.configured, false);
});
