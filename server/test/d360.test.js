import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createWhatsAppClient } from '../src/services/whatsapp.js';

let server;
let base;
let token;
const calls = [];

before(async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'tok360secret';
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/media')) return new Response(JSON.stringify({ id: 'm-360' }), { status: 200 });
    if (url.includes('/v1/configs/templates')) {
      return new Response(JSON.stringify({ waba_templates: [{ name: 'seguimiento', language: 'es_MX', status: 'approved' }, { name: 'x', status: 'rejected' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ messages: [{ id: `wamid.360.${calls.length}` }] }), { status: 200 });
  };
  const wa = createWhatsAppClient({ d360Key: 'KEY360', fetchImpl });
  server = createApp(openDb(':memory:'), { wa }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@securefleet.mx', password: 'admin123' }) });
  token = (await r.json()).token;
});
after(() => server.close());

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const hook = (tok, payload) => fetch(`${base}/whatsapp/webhook/360/${tok}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

test('360dialog: estado, envío con D360-API-KEY, documento y plantillas', async () => {
  const st = (await api('/whatsapp/status')).data;
  assert.equal(st.configured, true);
  assert.equal(st.provider, '360dialog');

  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal((await hook('tok360secret', { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: '5218110000001', profile: { name: 'Cliente 360' } }],
    messages: [{ id: 'wamid.in360', from: '5218110000001', timestamp: ts, type: 'text', text: { body: 'Hola' } }],
  } }] }] })).status, 200);
  const c = (await api('/contacts?wa=todos&q=8110000001')).data[0];
  assert.equal(c.phone, '528110000001');

  await api(`/whatsapp/conversations/${c.id}/send`, { method: 'POST', body: { body: 'Hola desde el CRM' } });
  const send = calls.at(-1);
  assert.equal(send.url, 'https://waba-v2.360dialog.io/messages');
  assert.equal(send.opts.headers['D360-API-KEY'], 'KEY360');
  assert.equal(JSON.parse(send.opts.body).to, '528110000001');

  const q = (await api('/quotes', { method: 'POST', body: { contact_id: c.id, items: [{ description: 'GPS', quantity: 1, unit_price: 1000 }] } })).data;
  assert.equal((await api(`/quotes/${q.id}/send-whatsapp`, { method: 'POST', body: {} })).status, 200);
  assert.equal(calls.at(-2).url, 'https://waba-v2.360dialog.io/media');
  assert.equal(JSON.parse(calls.at(-1).opts.body).document.id, 'm-360');

  const tpl = (await api('/whatsapp/templates')).data;
  assert.deepEqual(tpl.map((t) => t.name), ['seguimiento']);
});

test('360dialog: token del webhook, ecos del celular e historial', async () => {
  assert.equal((await hook('otro-token', { entry: [] })).status, 403);
  const ts = String(Math.floor(Date.now() / 1000));
  await hook('tok360secret', { entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [
    { from: '527204765054', to: '5218110000002', id: 'wamid.echo360', timestamp: ts, type: 'text', text: { body: 'Te escribo desde el celular' } },
  ] } }] }] });
  // Formato { event, data } que usa 360dialog para el historial
  await hook('tok360secret', { id: 'evt1', event: 'history', data: { history: [{ threads: [{ id: '5218110000002', messages: [
    { from: '5218110000002', id: 'wamid.h360', timestamp: String(Number(ts) - 60), type: 'text', text: { body: '¿Precio del GPS?' } },
  ] }] }] } });
  const c = (await api('/contacts?wa=todos&q=8110000002')).data[0];
  const msgs = (await api(`/whatsapp/conversations/${c.id}`)).data.messages;
  assert.deepEqual(msgs.map((m) => [m.direction, m.body]), [['in', '¿Precio del GPS?'], ['out', 'Te escribo desde el celular']]);
});
