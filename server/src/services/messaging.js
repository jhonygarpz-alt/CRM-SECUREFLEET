import { describeIncoming } from './whatsapp.js';
import { getSettings } from '../db.js';
import { normalizePhone } from '../utils.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** ¿Sigue abierta la ventana de 24 h para mensajes libres (sin plantilla)? */
export function windowOpen(contact, now = Date.now()) {
  if (!contact?.last_inbound_at) return false;
  return now - new Date(contact.last_inbound_at.replace(' ', 'T') + 'Z').getTime() < WINDOW_MS;
}

/** Guarda un mensaje saliente y actualiza el contacto. */
export function recordOutgoing(db, { contactId, waId, type, body, mediaId, filename, simulated, userId }) {
  // En modo WhatsApp Web el eco del propio envío puede registrarse antes: se completa ese registro.
  const existing = waId && db.prepare('SELECT id FROM wa_messages WHERE wa_message_id = ?').get(waId);
  if (existing) {
    db.prepare('UPDATE wa_messages SET user_id = COALESCE(user_id, ?), type = ?, body = ?, filename = COALESCE(?, filename) WHERE id = ?')
      .run(userId || null, type, body, filename || null, existing.id);
    return db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO wa_messages (contact_id, wa_message_id, direction, type, body, media_id, filename, status, user_id)
       VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?)`,
    )
    .run(contactId, waId, type, body, mediaId || null, filename || null, simulated ? 'simulated' : 'sent', userId || null);
  db.prepare("UPDATE contacts SET last_contact_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(contactId);
  return db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(info.lastInsertRowid);
}

const toSql = (ts) => (ts ? new Date(Number(ts) * 1000) : new Date()).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Guarda un mensaje (eco o historial) si no existe. Crea el contacto si hace falta.
 * Devuelve true si se insertó.
 */
function saveMessage(db, { phone, msg, direction, status, autoCreate, markUnread = true }) {
  if (!phone || !msg?.id) return false;
  if (db.prepare('SELECT 1 FROM wa_messages WHERE wa_message_id = ?').get(msg.id)) return false;
  let contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
  if (!contact) {
    if (!autoCreate) return false;
    const info = db.prepare(`INSERT INTO contacts (type, name, phone, source, status) VALUES ('lead', ?, ?, 'WhatsApp', 'nuevo')`)
      .run(`WhatsApp +${phone}`, phone);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  }
  const tsSql = toSql(msg.timestamp);
  const media = msg[msg.type] || {};
  db.prepare(`INSERT INTO wa_messages (contact_id, wa_message_id, direction, type, body, media_id, filename, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(contact.id, msg.id, direction, msg.type || 'text', describeIncoming(msg), media.id || null, media.filename || null,
      status || (direction === 'in' ? 'received' : 'sent'), tsSql);
  if (direction === 'in') {
    db.prepare(`UPDATE contacts SET last_inbound_at = MAX(COALESCE(last_inbound_at, ''), ?),
        last_contact_at = MAX(COALESCE(last_contact_at, ''), ?), unread_count = unread_count + ? WHERE id = ?`)
      .run(tsSql, tsSql, markUnread ? 1 : 0, contact.id);
  } else {
    db.prepare(`UPDATE contacts SET last_contact_at = MAX(COALESCE(last_contact_at, ''), ?) WHERE id = ?`).run(tsSql, contact.id);
  }
  return true;
}

/**
 * Procesa el payload de webhook de Meta: mensajes entrantes y actualizaciones de estado.
 * Crea leads automáticamente cuando escribe un número desconocido.
 */
export async function processWebhook(db, wa, payload) {
  const settings = getSettings(db);
  const result = { messages: 0, statuses: 0, newContacts: [] };
  // 360dialog envía algunos eventos (p. ej. historial) como { event, data } en lugar de entry/changes.
  if (payload && !payload.entry && payload.data && payload.event) {
    payload = { entry: [{ changes: [{ field: payload.event, value: payload.data }] }] };
  }

  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const profiles = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));

      for (const msg of value.messages || []) {
        const phone = normalizePhone(msg.from);
        let contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
        let isNew = false;
        if (!contact) {
          if (settings.wa_auto_create_leads !== '1') continue;
          const name = profiles[msg.from] || `WhatsApp +${phone}`;
          const info = db
            .prepare(`INSERT INTO contacts (type, name, phone, source, status) VALUES ('lead', ?, ?, 'WhatsApp', 'nuevo')`)
            .run(name, phone);
          contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
          db.prepare(`INSERT INTO activities (contact_id, type, subject, notes) VALUES (?, 'whatsapp', ?, ?)`).run(
            contact.id,
            'Nuevo lead desde WhatsApp',
            'Contacto creado automáticamente al recibir su primer mensaje.',
          );
          result.newContacts.push(contact.id);
          isNew = true;
        }

        const exists = db.prepare('SELECT id FROM wa_messages WHERE wa_message_id = ?').get(msg.id);
        if (exists) continue;

        const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
        const tsSql = ts.toISOString().replace('T', ' ').slice(0, 19);
        const media = msg[msg.type] || {};
        db.prepare(
          `INSERT INTO wa_messages (contact_id, wa_message_id, direction, type, body, media_id, filename, status, created_at)
           VALUES (?, ?, 'in', ?, ?, ?, ?, 'received', ?)`,
        ).run(contact.id, msg.id, msg.type, describeIncoming(msg), media.id || null, media.filename || null, tsSql);
        db.prepare(
          `UPDATE contacts SET last_inbound_at = ?, last_contact_at = ?, unread_count = unread_count + 1,
             updated_at = datetime('now') WHERE id = ?`,
        ).run(tsSql, tsSql, contact.id);
        result.messages++;

        if (isNew && settings.wa_welcome_message) {
          try {
            const sent = await wa.sendText(phone, settings.wa_welcome_message);
            recordOutgoing(db, { contactId: contact.id, waId: sent.id, type: 'text', body: settings.wa_welcome_message, simulated: sent.simulated });
          } catch (e) {
            console.error('No se pudo enviar mensaje de bienvenida:', e.message);
          }
        }
      }

      // Coexistencia: mensajes que el equipo envió desde la app WhatsApp Business del celular.
      for (const msg of value.message_echoes || []) {
        if (saveMessage(db, { phone: normalizePhone(msg.to), msg, direction: 'out', autoCreate: settings.wa_auto_create_leads === '1' })) {
          result.echoes = (result.echoes || 0) + 1;
        }
      }

      // Coexistencia: historial de conversaciones de la app (llega una vez, al conectar).
      for (const chunk of value.history || []) {
        for (const thread of chunk.threads || []) {
          const customer = normalizePhone(thread.id);
          for (const msg of thread.messages || []) {
            const direction = normalizePhone(msg.from) === customer ? 'in' : 'out';
            const status = String(msg.history_context?.status || (direction === 'in' ? 'received' : 'sent')).toLowerCase();
            if (saveMessage(db, { phone: customer, msg, direction, status, autoCreate: true, markUnread: false })) {
              result.history = (result.history || 0) + 1;
            }
          }
        }
      }

      // Coexistencia: nombres de la libreta de contactos de la app.
      for (const item of value.state_sync || []) {
        const c = item.contact;
        if (item.type !== 'contact' || item.action === 'remove' || !c?.phone_number) continue;
        const name = c.full_name || c.first_name;
        if (name) {
          db.prepare(`UPDATE contacts SET name = ? WHERE phone = ? AND name LIKE 'WhatsApp +%'`).run(name, normalizePhone(c.phone_number));
        }
      }

      for (const st of value.statuses || []) {
        const error = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title}` : null;
        // No retroceder estados (ej. un "delivered" que llega después de "read")
        const rank = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const current = db.prepare('SELECT status FROM wa_messages WHERE wa_message_id = ?').get(st.id);
        if (!current) continue;
        if ((rank[st.status] || 0) > (rank[current.status] || 0)) {
          db.prepare('UPDATE wa_messages SET status = ?, error = COALESCE(?, error) WHERE wa_message_id = ?').run(st.status, error, st.id);
        }
        result.statuses++;
      }
    }
  }
  return result;
}
