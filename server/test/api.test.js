import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createWhatsAppClient } from '../src/services/whatsapp.js';
import { computeQuote } from '../src/services/quotes.js';

let server;
let base;
let token;
const graphCalls = [];

// Cliente de WhatsApp "en vivo" con fetch simulado para verificar lo que se manda a Meta.
const fakeFetch = async (url, opts) => {
  graphCalls.push({ url, opts });
  if (url.endsWith('/media')) return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${graphCalls.length}` }] }), { status: 200 });
};
const APP_SECRET = 'secreto-de-prueba';

before(async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
  const db = openDb(':memory:');
  const wa = createWhatsAppClient({ token: 't', phoneNumberId: '123', appSecret: APP_SECRET, fetchImpl: fakeFetch });
  server = createApp(db, { wa }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer() };
}

function signedWebhook(payload) {
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return api('/whatsapp/webhook', { method: 'POST', body: raw, auth: false, headers: { 'X-Hub-Signature-256': sig } });
}

const incoming = (from, body, id, name = 'Pedro Cliente') => ({
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
  } }] }],
});

test('computeQuote calcula descuentos, IVA y recurrentes', () => {
  const r = computeQuote([
    { description: 'GPS', quantity: 10, unit_price: 1000, discount_pct: 10, tax_rate: 0.16, billing: 'unico' },
    { description: 'Plataforma', quantity: 10, unit_price: 300, tax_rate: 0.16, billing: 'mensual' },
  ]);
  assert.equal(r.subtotal, 13000);
  assert.equal(r.discount_total, 1000);
  assert.equal(r.tax_total, 1920);
  assert.equal(r.total, 13920);
  assert.equal(r.recurring_total, 3480);
});

test('login rechaza credenciales inválidas y acepta al admin', async () => {
  assert.equal((await api('/contacts')).status, 401);
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'admin@securefleet.mx', password: 'x' } })).status, 401);
  const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@securefleet.mx', password: 'admin123' } });
  assert.equal(r.status, 200);
  token = r.data.token;
});

test('verificación del webhook de Meta', async () => {
  const ok = await fetch(`${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`);
  assert.equal(await ok.text(), 'abc');
  const bad = await fetch(`${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=abc`);
  assert.equal(bad.status, 403);
});

test('webhook sin firma válida se rechaza', async () => {
  const r = await api('/whatsapp/webhook', { method: 'POST', body: incoming('5215500000000', 'hola', 'x1'), auth: false,
    headers: { 'X-Hub-Signature-256': 'sha256=bad' } });
  assert.equal(r.status, 401);
});

test('flujo completo: lead por WhatsApp → respuesta → cotización enviada por WhatsApp', async () => {
  // 1. Mensaje entrante de un número nuevo crea un lead
  assert.equal((await signedWebhook(incoming('5215511112222', 'Quiero GPS para 5 camionetas', 'wamid.in1'))).status, 200);
  // idempotente ante reintentos de Meta
  await signedWebhook(incoming('5215511112222', 'Quiero GPS para 5 camionetas', 'wamid.in1'));
  const contacts = (await api('/contacts?q=Pedro')).data;
  assert.equal(contacts.length, 1);
  const lead = contacts[0];
  assert.equal(lead.source, 'WhatsApp');
  assert.equal(lead.phone, '525511112222');

  const conv = (await api(`/whatsapp/conversations/${lead.id}`)).data;
  assert.equal(conv.messages.length, 1);
  assert.equal(conv.contact.window_open, true);
  assert.equal((await api('/whatsapp/unread')).data.total, 1);
  await api(`/whatsapp/conversations/${lead.id}/read`, { method: 'POST' });
  assert.equal((await api('/whatsapp/unread')).data.total, 0);

  // 2. Respuesta del vendedor
  const sent = await api(`/whatsapp/conversations/${lead.id}/send`, { method: 'POST', body: { body: '¡Hola Pedro!' } });
  assert.equal(sent.status, 201);
  const call = graphCalls.at(-1);
  assert.match(call.url, /\/123\/messages$/);
  assert.deepEqual(JSON.parse(call.opts.body).to, '525511112222');

  // 3. Estado "read" desde Meta actualiza el mensaje
  await signedWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: sent.data.wa_message_id, status: 'read' }] } }] }] });
  await signedWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: sent.data.wa_message_id, status: 'delivered' }] } }] }] });
  const after = (await api(`/whatsapp/conversations/${lead.id}`)).data.messages.at(-1);
  assert.equal(after.status, 'read');

  // 4. Catálogo + oportunidad + cotización
  const prod = (await api('/products', { method: 'POST', body: { sku: 'GPS1', name: 'GPS 4G', price: 1890 } })).data;
  const deal = (await api('/deals', { method: 'POST', body: { title: '5 camionetas', contact_id: lead.id } })).data;
  assert.equal(deal.stage, 'prospecto');
  const quote = await api('/quotes', { method: 'POST', body: {
    contact_id: lead.id, deal_id: deal.id,
    items: [{ product_id: prod.id, description: prod.name, quantity: 5, unit_price: 1890, tax_rate: 0.16 }],
  } });
  assert.equal(quote.status, 201);
  assert.match(quote.data.folio, /^SF-COT-\d{4}-0001$/);
  assert.equal(quote.data.total, 10962);
  assert.equal((await api(`/deals/${deal.id}`)).data.stage, 'propuesta');

  const pdf = await api(`/quotes/${quote.data.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(pdf.data).subarray(0, 4).toString(), '%PDF');

  // 5. Enviar cotización por WhatsApp: sube el PDF y manda el documento
  const send = await api(`/quotes/${quote.data.id}/send-whatsapp`, { method: 'POST', body: {} });
  assert.equal(send.status, 200);
  assert.equal(send.data.quote.status, 'enviada');
  assert.match(graphCalls.at(-2).url, /\/media$/);
  const docMsg = JSON.parse(graphCalls.at(-1).opts.body);
  assert.equal(docMsg.type, 'document');
  assert.equal(docMsg.document.id, 'media-1');

  // 6. Aceptar la cotización gana la oportunidad y convierte al lead en cliente
  await api(`/quotes/${quote.data.id}`, { method: 'PUT', body: { status: 'aceptada' } });
  assert.equal((await api(`/deals/${deal.id}`)).data.stage, 'ganado');
  assert.equal((await api(`/contacts/${lead.id}`)).data.type, 'cliente');

  const dash = (await api('/dashboard')).data;
  assert.equal(dash.kpis.clientes, 1);
});

test('fuera de la ventana de 24 h se exige plantilla', async () => {
  const c = (await api('/contacts', { method: 'POST', body: { name: 'Sin chat', phone: '55 1234 9999' } })).data;
  assert.equal(c.phone, '525512349999');
  const r = await api(`/whatsapp/conversations/${c.id}/send`, { method: 'POST', body: { body: 'hola' } });
  assert.equal(r.status, 409);
  const t = await api(`/whatsapp/conversations/${c.id}/template`, { method: 'POST', body: { name: 'seguimiento', params: ['Ana'] } });
  assert.equal(t.status, 201);
  const payload = JSON.parse(graphCalls.at(-1).opts.body);
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.components[0].parameters[0].text, 'Ana');
});

test('celular mexicano 521… se une al contacto existente 52…', async () => {
  const c = (await api('/contacts', { method: 'POST', body: { name: 'Mismo Cliente', phone: '55 1111 3333' } })).data;
  assert.equal(c.phone, '525511113333');
  await signedWebhook(incoming('5215511113333', 'hola', 'wamid.mx1', 'Otro nombre'));
  assert.equal((await api('/contacts?q=5511113333')).data.length, 1);
  assert.equal((await api(`/whatsapp/conversations/${c.id}`)).data.messages.length, 1);
});

test('teléfono duplicado devuelve 409', async () => {
  const r = await api('/contacts', { method: 'POST', body: { name: 'Otro', phone: '5512349999' } });
  assert.equal(r.status, 409);
});
