import crypto from 'node:crypto';

/**
 * Cliente para la API oficial de WhatsApp Business Cloud (Meta Graph API).
 *
 * Si no hay credenciales configuradas trabaja en "modo simulación": los mensajes se
 * guardan en el CRM con estado `simulated` pero no se envían, para poder probar el flujo.
 */
export function createWhatsAppClient({
  token = process.env.WHATSAPP_TOKEN,
  phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  appSecret = process.env.WHATSAPP_APP_SECRET,
  apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0',
  fetchImpl = globalThis.fetch,
} = {}) {
  const configured = Boolean(token && phoneNumberId);
  const base = `https://graph.facebook.com/${apiVersion}`;

  async function graph(pathname, { method = 'POST', json, form } = {}) {
    const res = await fetchImpl(`${base}/${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.error_data?.details || data?.error?.message || `HTTP ${res.status}`;
      const err = new Error(`WhatsApp API: ${msg}`);
      err.status = 502;
      err.code = data?.error?.code;
      throw err;
    }
    return data;
  }

  async function sendMessage(to, payload) {
    if (!configured) return { id: `sim-${crypto.randomUUID()}`, simulated: true };
    const data = await graph(`${phoneNumberId}/messages`, {
      json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
    });
    return { id: data.messages?.[0]?.id, simulated: false };
  }

  return {
    configured,
    info: { phoneNumberId: phoneNumberId || null, businessAccountId: businessAccountId || null, apiVersion },

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
      const media = await graph(`${phoneNumberId}/media`, { form });
      const sent = await sendMessage(to, { type: 'document', document: { id: media.id, filename, caption } });
      return { ...sent, mediaId: media.id };
    },

    markAsRead(messageId) {
      if (!configured) return Promise.resolve();
      return graph(`${phoneNumberId}/messages`, {
        json: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      }).catch(() => {});
    },

    /** Lista las plantillas aprobadas de la cuenta de WhatsApp Business. */
    async listTemplates() {
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
