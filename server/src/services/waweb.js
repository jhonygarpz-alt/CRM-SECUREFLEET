import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { processWebhook } from './messaging.js';
import { normalizePhone } from '../utils.js';

/**
 * Conexión "tipo WhatsApp Web": el CRM se vincula al número como un dispositivo más
 * (WhatsApp Business → Dispositivos vinculados → escanear QR), igual que WhatsApp Web.
 *
 * No es la API oficial de Meta: sirve para atender y dar seguimiento uno a uno. Los envíos
 * se espacian para evitar comportamiento de "envío masivo" que pueda provocar un bloqueo.
 *
 * Expone la misma interfaz que el cliente de la API oficial, y traduce los eventos a la
 * estructura de webhooks de WhatsApp Cloud para reutilizar processWebhook().
 */
const STATUS = { 0: 'failed', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
const SEND_GAP_MS = 1500;
const RECENT_SECONDS = 180; // ecos del celular: solo mensajes recientes (no el historial)

function unwrap(message) {
  let m = message || {};
  for (let i = 0; i < 4; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message
      || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** Convierte un mensaje de WhatsApp Web al formato de la API de WhatsApp Cloud. */
export function toCloudMessage(m) {
  if (!m) return null;
  if (m.conversation) return { type: 'text', text: { body: m.conversation } };
  if (m.extendedTextMessage) return { type: 'text', text: { body: m.extendedTextMessage.text || '' } };
  if (m.imageMessage) return { type: 'image', image: { caption: m.imageMessage.caption } };
  if (m.videoMessage) return { type: 'video', video: { caption: m.videoMessage.caption } };
  if (m.documentMessage) return { type: 'document', document: { filename: m.documentMessage.fileName, caption: m.documentMessage.caption } };
  if (m.audioMessage) return { type: 'audio', audio: {} };
  if (m.stickerMessage) return { type: 'sticker', sticker: {} };
  if (m.locationMessage) {
    const l = m.locationMessage;
    return { type: 'location', location: { latitude: l.degreesLatitude, longitude: l.degreesLongitude, name: l.name } };
  }
  if (m.contactMessage || m.contactsArrayMessage) return { type: 'contacts', contacts: [] };
  if (m.reactionMessage) return { type: 'reaction', reaction: { emoji: m.reactionMessage.text } };
  if (m.buttonsResponseMessage) return { type: 'button', button: { text: m.buttonsResponseMessage.selectedDisplayText } };
  if (m.listResponseMessage) return { type: 'interactive', interactive: { list_reply: { title: m.listResponseMessage.title } } };
  return null; // protocolo, encuestas, borrados, etc.
}

/** Obtiene el JID con teléfono (algunos chats llegan con identificador @lid). */
function phoneJid(key) {
  return [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantPn, key.participantAlt]
    .find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
}

const digits = (jid) => String(jid || '').split('@')[0].split(':')[0];

export function createWaWebClient(db, { authDir } = {}) {
  const dir = authDir || path.join(path.dirname(path.resolve(process.env.DB_PATH || './data/crm.db')), 'waweb-auth');
  let sock = null;
  let state = 'disconnected'; // disconnected | connecting | qr | connected
  let qr = null;
  let me = null;
  let lastError = null;
  let starting = false;
  let retry = 0;
  const jidCache = new Map();
  const stats = { received: 0, skipped: 0, lastReceivedAt: null };
  const keyById = new Map(); // id de mensaje → key (para marcar como leído)
  let queue = Promise.resolve();

  const remember = (key) => {
    keyById.set(key.id, key);
    if (keyById.size > 2000) keyById.delete(keyById.keys().next().value);
  };

  /** Teléfono del chat; si WhatsApp solo da el identificador @lid, se traduce a número. */
  async function resolvePhoneJid(key) {
    const direct = phoneJid(key);
    if (direct) return direct;
    const lid = [key.remoteJid, key.remoteJidAlt].find((j) => typeof j === 'string' && j.endsWith('@lid'));
    if (!lid) return null;
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(lid);
      return pn ? `${digits(pn)}@s.whatsapp.net` : null;
    } catch {
      return null;
    }
  }

  async function handleUpsert({ messages, type }, client) {
    for (const msg of messages || []) {
      const key = msg.key || {};
      if (!key.id || key.remoteJid === 'status@broadcast' || String(key.remoteJid).endsWith('@g.us')
        || String(key.remoteJid).endsWith('@newsletter') || String(key.remoteJid).endsWith('@broadcast')) continue;
      const jid = await resolvePhoneJid(key);
      if (!jid) {
        stats.skipped++;
        console.warn('[waweb] mensaje sin número de teléfono identificable:', key.remoteJid);
        continue;
      }
      const body = toCloudMessage(unwrap(msg.message));
      if (!body) continue;
      const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || Math.floor(Date.now() / 1000);
      const cloud = { id: key.id, timestamp: String(ts), ...body };
      remember(key);
      if (key.fromMe) {
        // Mensaje enviado desde el celular (o el eco de uno enviado por el CRM, que se ignora por id).
        if (Date.now() / 1000 - ts > RECENT_SECONDS) continue;
        const payload = { entry: [{ changes: [{ field: 'smb_message_echoes', value: {
          message_echoes: [{ ...cloud, from: me || '', to: digits(jid) }],
        } }] }] };
        setTimeout(() => processWebhook(db, client, payload).catch((e) => console.error('[waweb] eco:', e.message)), 2000);
      } else {
        if (type !== 'notify') continue;
        const from = digits(jid);
        stats.received++;
        stats.lastReceivedAt = new Date().toISOString();
        await processWebhook(db, client, { entry: [{ changes: [{ field: 'messages', value: {
          contacts: [{ wa_id: from, profile: { name: msg.pushName || undefined } }],
          messages: [{ ...cloud, from }],
        } }] }] }).catch((e) => console.error('[waweb] entrante:', e.message));
      }
    }
  }

  async function handleUpdates(updates, client) {
    const statuses = [];
    for (const { key, update } of updates || []) {
      if (!key?.fromMe || update?.status === undefined || !STATUS[update.status]) continue;
      statuses.push({ id: key.id, status: STATUS[update.status] });
    }
    if (statuses.length) {
      await processWebhook(db, client, { entry: [{ changes: [{ field: 'messages', value: { statuses } }] }] })
        .catch((e) => console.error('[waweb] estados:', e.message));
    }
  }

  async function start() {
    if (starting || state === 'connected') return;
    starting = true;
    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, Browsers, DisconnectReason } = baileys;
      const { default: pino } = await import('pino');
      const logger = pino({ level: 'silent' });
      fs.mkdirSync(dir, { recursive: true });
      const { state: auth, saveCreds } = await useMultiFileAuthState(dir);
      let version;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch {
        /* usa la versión incluida en la librería */
      }
      state = 'connecting';
      sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
        logger,
        browser: Browsers.macOS('SecureFleet CRM'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async (u) => {
        if (u.qr) {
          state = 'qr';
          qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 300 });
        }
        if (u.connection === 'open') {
          state = 'connected';
          qr = null;
          retry = 0;
          lastError = null;
          me = normalizePhone(digits(sock.user?.id));
          console.log(`[waweb] conectado como +${me}`);
        }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          lastError = u.lastDisconnect?.error?.message || null;
          sock = null;
          state = 'disconnected';
          if (code === DisconnectReason.loggedOut) {
            console.log('[waweb] sesión cerrada desde el celular; se requiere escanear de nuevo');
            fs.rmSync(dir, { recursive: true, force: true });
            me = null;
            setTimeout(start, 1000);
          } else {
            retry = Math.min(retry + 1, 6);
            setTimeout(start, 2000 * retry);
          }
        }
      });
      sock.ev.on('messages.upsert', (e) => handleUpsert(e, client));
      sock.ev.on('messages.update', (e) => handleUpdates(e, client));
    } catch (e) {
      lastError = e.message;
      state = 'disconnected';
      console.error('[waweb] no se pudo iniciar:', e.message);
      setTimeout(start, 10000);
    } finally {
      starting = false;
    }
  }

  function ensureConnected() {
    if (state !== 'connected' || !sock) {
      const err = new Error('WhatsApp no está conectado. Entra a Configuración y escanea el código QR con WhatsApp Business → Dispositivos vinculados.');
      err.status = 503;
      throw err;
    }
  }

  async function resolveJid(phone) {
    const n = String(phone).replace(/\D/g, '');
    if (jidCache.has(n)) return jidCache.get(n);
    const candidates = [n];
    if (n.startsWith('52') && n.length === 12) candidates.push('521' + n.slice(2));
    for (const c of candidates) {
      const [res] = (await sock.onWhatsApp(c).catch(() => [])) || [];
      if (res?.exists) {
        jidCache.set(n, res.jid);
        return res.jid;
      }
    }
    const err = new Error(`El número +${n} no tiene WhatsApp`);
    err.status = 400;
    throw err;
  }

  /** Encola los envíos con una pausa entre ellos para no parecer envío masivo. */
  function enqueue(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, SEND_GAP_MS)));
    return run;
  }

  async function send(to, content) {
    ensureConnected();
    return enqueue(async () => {
      const jid = await resolveJid(to);
      const sent = await sock.sendMessage(jid, content);
      if (sent?.key) remember(sent.key);
      return { id: sent?.key?.id, simulated: false };
    });
  }

  const client = {
    get configured() { return true; },
    provider: 'waweb',
    requiresWindow: false,
    get info() { return { provider: 'waweb', phoneNumberId: null, businessAccountId: null }; },
    start,
    status() {
      return { state, qr: state === 'qr' ? qr : null, me, lastError, ...stats };
    },
    async logout() {
      try { await sock?.logout(); } catch { /* ya desconectado */ }
      fs.rmSync(dir, { recursive: true, force: true });
      sock = null;
      me = null;
      state = 'disconnected';
      setTimeout(start, 1000);
    },
    sendText(to, body) {
      return send(to, { text: body });
    },
    async sendTemplate() {
      const err = new Error('Las plantillas solo existen en la API oficial. En modo WhatsApp Web puedes escribir el mensaje directamente.');
      err.status = 400;
      throw err;
    },
    async sendDocument(to, buffer, filename, caption, mime = 'application/pdf') {
      return send(to, { document: buffer, mimetype: mime, fileName: filename, caption });
    },
    async markAsRead(messageId) {
      const key = keyById.get(messageId);
      if (key && sock && state === 'connected') await sock.readMessages([key]).catch(() => {});
    },
    async listTemplates() {
      return [];
    },
    verifySignature() {
      return false; // en este modo no hay webhooks de Meta
    },
    // Para pruebas
    _handleUpsert: (e) => handleUpsert(e, client),
    _handleUpdates: (e) => handleUpdates(e, client),
    _setConnected(fakeSock, number) { sock = fakeSock; state = 'connected'; me = number; },
  };
  return client;
}
