import fs from 'node:fs';
import path from 'node:path';
import { mediaDir } from '../db.js';
import { recordOutgoing, windowOpen } from './messaging.js';

/** Reemplaza {nombre}, {nombre_completo} y {empresa} con los datos del contacto. */
export function personalize(body, contact) {
  const first = String(contact.name || '').trim().split(/\s+/)[0] || '';
  return String(body)
    .replace(/\{nombre\}/gi, first)
    .replace(/\{nombre_completo\}/gi, contact.name || '')
    .replace(/\{empresa\}/gi, contact.company || contact.name || '');
}

/**
 * Envía las campañas en segundo plano: un mensaje a la vez, con una pausa al azar entre
 * envíos (min_delay–max_delay segundos) y un límite de envíos por día, para cuidar el número.
 */
export function createCampaignRunner(db, wa, { tickMs = 5000, random = Math.random } = {}) {
  let nextAt = 0;
  let busy = false;
  let timer = null;

  const sentToday = () => db.prepare(`SELECT COUNT(*) AS n FROM campaign_recipients
      WHERE status = 'enviado' AND date(sent_at, 'localtime') = date('now', 'localtime')`).get().n;

  async function tick() {
    if (busy || Date.now() < nextAt) return null;
    const camp = db.prepare(`SELECT * FROM campaigns WHERE status = 'enviando' ORDER BY started_at, id LIMIT 1`).get();
    if (!camp) return null;

    const rec = db.prepare(`SELECT r.id, r.contact_id, c.name, c.company, c.phone, c.whatsapp_opt_in, c.last_inbound_at
        FROM campaign_recipients r JOIN contacts c ON c.id = r.contact_id
        WHERE r.campaign_id = ? AND r.status = 'pendiente' ORDER BY r.id LIMIT 1`).get(camp.id);
    if (!rec) {
      db.prepare(`UPDATE campaigns SET status = 'terminada', finished_at = datetime('now') WHERE id = ?`).run(camp.id);
      return 'terminada';
    }

    const mark = (status, extra = {}) => db.prepare(`UPDATE campaign_recipients SET status = ?, error = ?, wa_message_id = ?,
        sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE sent_at END WHERE id = ?`)
      .run(status, extra.error || null, extra.waId || null, status, rec.id);

    if (!rec.phone || !rec.whatsapp_opt_in) {
      mark('omitido', { error: !rec.phone ? 'Sin teléfono' : 'No autorizó WhatsApp' });
      return 'omitido';
    }
    if (wa.configured && wa.requiresWindow !== false && !windowOpen(rec)) {
      mark('omitido', { error: 'Ventana de 24 h cerrada: en la API oficial se requiere plantilla aprobada' });
      return 'omitido';
    }

    // El límite diario solo cuenta envíos reales (los omitidos no consumen cupo).
    if (sentToday() >= camp.daily_limit) return 'limite';

    busy = true;
    try {
      const text = personalize(camp.body, rec);
      let sent;
      if (camp.media_path) {
        const buffer = fs.readFileSync(path.join(mediaDir(), path.basename(camp.media_path)));
        sent = await wa.sendImage(rec.phone, buffer, camp.media_mime || 'image/jpeg', text);
      } else {
        sent = await wa.sendText(rec.phone, text);
      }
      const msg = recordOutgoing(db, { contactId: rec.contact_id, waId: sent.id, type: camp.media_path ? 'image' : 'text',
        body: camp.media_path ? `[imagen] ${text}` : text, simulated: sent.simulated, userId: camp.created_by });
      if (camp.media_path) {
        db.prepare('UPDATE wa_messages SET media_mime = ?, media_path = ? WHERE id = ?').run(camp.media_mime, camp.media_path, msg.id);
      }
      mark('enviado', { waId: sent.id });
      db.prepare(`INSERT INTO activities (contact_id, type, subject, user_id, done, done_at)
          VALUES (?, 'whatsapp', ?, ?, 1, datetime('now'))`).run(rec.contact_id, `Campaña WhatsApp: ${camp.name}`, camp.created_by);
      db.prepare(`UPDATE contacts SET status = CASE WHEN status = 'nuevo' THEN 'contactado' ELSE status END WHERE id = ?`).run(rec.contact_id);
      return 'enviado';
    } catch (e) {
      mark('fallido', { error: e.message });
      // Si WhatsApp no está conectado, se pausa la campaña en lugar de marcar a todos como fallidos.
      if (e.status === 503) db.prepare(`UPDATE campaigns SET status = 'pausada' WHERE id = ?`).run(camp.id);
      return 'fallido';
    } finally {
      busy = false;
      const span = Math.max(0, camp.max_delay - camp.min_delay);
      nextAt = Date.now() + (camp.min_delay + random() * span) * 1000;
    }
  }

  return {
    tick,
    start() {
      if (!timer) timer = setInterval(() => tick().catch((e) => console.error('[campañas]', e.message)), tickMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    nextSendAt: () => (nextAt > Date.now() ? new Date(nextAt).toISOString() : null),
    sentToday,
    resetDelay() { nextAt = 0; },
  };
}
