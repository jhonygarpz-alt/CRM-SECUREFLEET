import crypto from 'node:crypto';
import { createWaWebClient } from './waweb.js';

const D360_BASE = 'https://waba-v2.360dialog.io';

/**
 * Cliente para la API de WhatsApp Business Cloud.
 *
 * Proveedores:
 *  - `meta`: API de Meta directa (graph.facebook.com) con token y Phone Number ID.
 *  - `360dialog`: proveedor oficial de Meta (BSP). Misma estructura de mensajes que la API de Meta,
 *    pero en waba-v2.360dialog.io con el encabezado D360-API-KEY; la clave ya identifica el número.
 *    Permite conectar un número que sigue usándose en la app WhatsApp Business (coexistencia).
 *
 * Si no hay credenciales configuradas trabaja en "modo simulación": los mensajes se
 * guardan en el CRM con estado `simulated` pero no se envían, para poder probar el flujo.
 */
export function createWhatsAppClient({
  d360Key = process.env.D360_API_KEY,
  token = process.env.WHATSAPP_TOKEN,
  phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  appSecret = process.env.WHATSAPP_APP_SECRET,
  apiVersion = process.env.WHATSAPP_API_VERSION || 'v26.0',
  fetchImpl = globalThis.fetch,
} = {}) {
  const provider = d360Key ? '360dialog' : 'meta';
  const is360 = provider === '360dialog';
  const configured = is360 ? Boolean(d360Key) : Boolean(token && phoneNumberId);
  const base = is360 ? D360_BASE : `https://graph.facebook.com/${apiVersion}`;
  // Rutas: en 360dialog la clave ya identifica el número, no se usa el Phone Number ID.
  const path = (p) => (is360 ? p : `${phoneNumberId}/${p}`);

  async function graph(pathname, { method = 'POST', json, form } = {}) {
    const res = await fetchImpl(`${base}/${pathname}`, {
      method,
      headers: {
        ...(is360 ? { 'D360-API-KEY': d360Key } : { Authorization: `Bearer ${token}` }),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data?.error || data?.errors?.[0] || data?.meta || {};
      const msg = e.error_data?.details || e.details || e.message || e.title || data?.message || `HTTP ${res.status}`;
      const err = new Error(`WhatsApp API: ${msg}`);
      err.status = 502;
      err.code = data?.error?.code;
      throw err;
    }
    return data;
  }

  async function sendMessage(to, payload) {
    if (!configured) return { id: `sim-${crypto.randomUUID()}`, simulated: true };
    const data = await graph(path('messages'), {
      json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
    });
    return { id: data.messages?.[0]?.id, simulated: false };
  }

  return {
    configured,
    provider,
    requiresWindow: true, // la API oficial solo permite mensajes libres 24 h después del último mensaje del cliente
    info: { provider, phoneNumberId: is360 ? null : phoneNumberId || null, businessAccountId: businessAccountId || null, apiVersion },

    sendText(to, body) {
      return sendMessage(to, { type: 'text', text: { preview_url: true, body } });
    },

    /** Envía una plantilla aprobada (necesario fuera de la ventana de 24 h). */
    sendTemplate(to, name, language = 'es_MX', bodyParams = []) {
      const components = bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }]
        : undefined;
      return sendMessage(to, { type: 'template', template: { name, language: { code: language }, components } });
    },

    /** Sube un archivo (ej. PDF de cotización) y lo envía como documento. */
    async sendDocument(to, buffer, filename, caption, mime = 'application/pdf') {
      if (!configured) return { id: `sim-${crypto.randomUUID()}`, simulated: true };
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mime);
      form.append('file', new Blob([buffer], { type: mime }), filename);
      const media = await graph(path('media'), { form });
      const sent = await sendMessage(to, { type: 'document', document: { id: media.id, filename, caption } });
      return { ...sent, mediaId: media.id };
    },

    markAsRead(messageId) {
      if (!configured) return Promise.resolve();
      return graph(path('messages'), {
        json: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      }).catch(() => {});
    },

    /** Lista las plantillas aprobadas de la cuenta de WhatsApp Business. */
    async listTemplates() {
      if (is360) {
        const data = await graph('v1/configs/templates?limit=200', { method: 'GET' });
        return (data.waba_templates || data.data || []).map((t) => ({ ...t, status: String(t.status || '').toUpperCase() }));
      }
      if (!configured || !businessAccountId) return [];
      const data = await graph(`${businessAccountId}/message_templates?limit=100&fields=name,language,status,category,components`, {
        method: 'GET',
      });
      return data.data || [];
    },

    /** Valida la firma X-Hub-Signature-256 que Meta agrega a cada webhook. */
    verifySignature(rawBody, header) {
      if (!appSecret) return true; // sin secreto configurado no se puede validar
      if (!header || !rawBody) return false;
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(String(header));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

/**
 * Cliente cuya configuración se resuelve en cada uso: primero lo guardado en la base de datos
 * (conexión hecha con el botón "Conectar WhatsApp"), después las variables de entorno.
 */
export function createDynamicWhatsAppClient(db, { fetchImpl = globalThis.fetch } = {}) {
  // Modo "WhatsApp Web" (dispositivo vinculado con QR), sin API oficial.
  if (process.env.WHATSAPP_PROVIDER === 'waweb') return createWaWebClient(db);
  const current = () => {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN
      ('secret_wa_token','wa_phone_number_id','wa_waba_id')`).all();
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return createWhatsAppClient({
      token: cfg.secret_wa_token || process.env.WHATSAPP_TOKEN,
      phoneNumberId: cfg.wa_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: cfg.wa_waba_id || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      fetchImpl,
    });
  };
  return {
    get configured() { return current().configured; },
    get provider() { return current().provider; },
    requiresWindow: true,
    get info() { return current().info; },
    sendText: (...a) => current().sendText(...a),
    sendTemplate: (...a) => current().sendTemplate(...a),
    sendDocument: (...a) => current().sendDocument(...a),
    markAsRead: (...a) => current().markAsRead(...a),
    listTemplates: (...a) => current().listTemplates(...a),
    verifySignature: (...a) => current().verifySignature(...a),
  };
}

/**
 * Pasos del registro integrado (Embedded Signup) de Meta, incluido el modo coexistencia
 * (el número sigue funcionando en la app WhatsApp Business del celular).
 */
export function createSignupClient({
  appId = process.env.WHATSAPP_APP_ID,
  appSecret = process.env.WHATSAPP_APP_SECRET,
  apiVersion = process.env.WHATSAPP_API_VERSION || 'v26.0',
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = `https://graph.facebook.com/${apiVersion}`;
  async function call(url, { method = 'GET', token, json } = {}) {
    const res = await fetchImpl(url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Meta: ${data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}`}`);
      err.status = 502;
      throw err;
    }
    return data;
  }
  return {
    enabled: Boolean(appId && appSecret && process.env.WHATSAPP_CONFIG_ID),
    /** Cambia el código de un solo uso por un token de negocio de larga duración. */
    async exchangeCode(code) {
      const q = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
      const data = await call(`${base}/oauth/access_token?${q}`);
      if (!data.access_token) throw Object.assign(new Error('Meta no devolvió un token'), { status: 502 });
      return data.access_token;
    },
    phoneNumbers: (wabaId, token) =>
      call(`${base}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, { token }).then((d) => d.data || []),
    phoneInfo: (phoneId, token) => call(`${base}/${phoneId}?fields=display_phone_number,verified_name`, { token }),
    subscribeApp: (wabaId, token) => call(`${base}/${wabaId}/subscribed_apps`, { method: 'POST', token }),
    /** Coexistencia: pide a Meta sincronizar contactos e historial de la app (disponible 24 h tras conectar). */
    requestSync: (phoneId, token, syncType) =>
      call(`${base}/${phoneId}/smb_app_data`, { method: 'POST', token, json: { messaging_product: 'whatsapp', sync_type: syncType } }),
  };
}

/** Extrae un texto legible de un mensaje entrante de WhatsApp. */
export function describeIncoming(msg) {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? '';
    case 'button':
      return msg.button?.text ?? '';
    case 'interactive':
      return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[respuesta interactiva]';
    case 'image':
      return msg.image?.caption ? `[imagen] ${msg.image.caption}` : '[imagen]';
    case 'video':
      return msg.video?.caption ? `[video] ${msg.video.caption}` : '[video]';
    case 'document':
      return `[documento] ${msg.document?.filename || ''}`.trim();
    case 'audio':
      return '[nota de voz]';
    case 'sticker':
      return '[sticker]';
    case 'location':
      return `[ubicación] ${msg.location?.name || ''} ${msg.location?.latitude},${msg.location?.longitude}`.trim();
    case 'contacts':
      return '[contacto compartido]';
    case 'reaction':
      return `[reacción ${msg.reaction?.emoji || ''}]`;
    default:
      return `[${msg.type}]`;
  }
}
