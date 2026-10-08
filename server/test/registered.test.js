import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { processWebhook } from '../src/services/messaging.js';

let server;
let base;
let token;
let db;
const wa = { configured: false, provider: 'test', requiresWindow: false, sendText: async () => ({ id: 'x', simulated: true }), markAsRead: async () => {} };

before(async () => {
  db = openDb(':memory:');
  db.prepare("UPDATE settings SET value = '' WHERE key = 'wa_welcome_message'").run();
  server = createApp(db, { wa }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@securefleet.mx', password: 'admin123' }),
  });
  token = (await r.json()).token;
});
after(() => server.close());

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
};

const incoming = (from, id, name) => processWebhook(db, wa, { entry: [{ changes: [{ value: {
  contacts: [{ wa_id: from, profile: { name } }],
  messages: [{ from, id, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'hola' } }],
} }] }] });

test('los chats de números no registrados van a "Otros chats" y no a leads', async () => {
  const lead = await api('/contacts', { method: 'POST', body: { name: 'Lead Expo', company: 'Transportes X', phone: '525511110000' } });
  await incoming('525511110000', 'wamid.lead1', 'Lead Expo');
  await incoming('525599990000', 'wamid.pers1', 'Amigo');

  const leads = await api('/whatsapp/conversations');
  assert.deepEqual(leads.map((c) => c.id), [lead.id]);
  const otros = await api('/whatsapp/conversations?scope=otros');
  assert.equal(otros.length, 1);
  assert.equal(otros[0].name, 'Amigo');
  assert.deepEqual(await api('/whatsapp/unread'), { total: 1, others: 1 });
  assert.ok(!(await api('/contacts')).some((c) => c.name === 'Amigo'));

  await api(`/whatsapp/conversations/${otros[0].id}/register`, { method: 'POST', body: { name: 'Pedro', company: 'Fletes P' } });
  assert.equal((await api('/whatsapp/conversations')).length, 2);
  assert.ok((await api('/contacts')).some((c) => c.name === 'Pedro' && c.company === 'Fletes P'));
});

test('importar un teléfono que solo existía como chat lo registra en lugar de omitirlo', async () => {
  await incoming('525588880000', 'wamid.imp1', 'Desconocido');
  const r = await api('/contacts/import', { method: 'POST', body: [{ name: 'Ana Flotas', company: 'Flotas Ana', phone: '525588880000' }] });
  assert.equal(r.created, 1);
  const c = (await api('/contacts?q=Flotas Ana'))[0];
  assert.equal(c.wa_registered, 1);
  assert.equal(c.phone, '525588880000');
});

test('migración: contactos creados automáticamente por WhatsApp quedan sin registrar', () => {
  const mem = openDb(':memory:');
  assert.ok(mem.prepare('PRAGMA table_info(contacts)').all().some((c) => c.name === 'wa_registered'));
});
