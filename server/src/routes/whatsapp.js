import { Router } from 'express';
import { HttpError, asyncHandler } from '../utils.js';
import { requireAdmin } from '../auth.js';
import { getSettings } from '../db.js';
import { processWebhook, recordOutgoing, windowOpen } from '../services/messaging.js';

/** Endpoints públicos que Meta llama (verificación y recepción del webhook). */
export function whatsappWebhookRoutes(db, wa) {
  const r = Router();

  r.get('/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(challenge);
    res.sendStatus(403);
  });

  r.post('/whatsapp/webhook', asyncHandler(async (req, res) => {
    if (!wa.verifySignature(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    // Meta reintenta si no respondemos 200 rápido; procesamos y respondemos.
    try {
      await processWebhook(db, wa, req.body);
    } catch (e) {
      console.error('Error procesando webhook de WhatsApp:', e);
    }
    res.sendStatus(200);
  }));

  return r;
}

/** Endpoints autenticados para el equipo de ventas. */
export function whatsappRoutes(db, wa, signup = { enabled: false }) {
  const r = Router();

  const contactOr404 = (id) => {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!c) throw new HttpError(404, 'Contacto no encontrado');
    if (!c.phone) throw new HttpError(400, 'El contacto no tiene teléfono');
    return c;
  };

  r.get('/whatsapp/status', asyncHandler(async (_req, res) => {
    res.json({
      configured: wa.configured,
      mode: wa.configured ? 'live' : 'simulacion',
      ...wa.info,
      webhookVerifyTokenSet: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      signatureValidation: Boolean(process.env.WHATSAPP_APP_SECRET),
      displayPhone: getSettings(db).wa_display_phone || null,
      verifiedName: getSettings(db).wa_verified_name || null,
      connectedVia: getSettings(db).secret_wa_token ? 'embedded_signup' : wa.configured ? 'env' : null,
      coexistence: getSettings(db).wa_coexistence === '1',
      // Datos públicos para abrir el registro integrado de Meta desde el navegador.
      signup: signup.enabled
        ? { appId: process.env.WHATSAPP_APP_ID, configId: process.env.WHATSAPP_CONFIG_ID, apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0' }
        : null,
    });
  }));

  const saveSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  /**
   * Finaliza el registro integrado de Meta: recibe el código del popup de Facebook,
   * obtiene el token, suscribe la app a los webhooks y guarda el número conectado.
   */
  r.post('/whatsapp/embedded-signup', requireAdmin, asyncHandler(async (req, res) => {
    if (!signup.enabled) throw new HttpError(400, 'Falta configurar WHATSAPP_APP_ID, WHATSAPP_APP_SECRET y WHATSAPP_CONFIG_ID en el servidor');
    const { code, waba_id: wabaId, coexistence = true } = req.body || {};
    let phoneId = req.body?.phone_number_id;
    if (!code || !wabaId) throw new HttpError(400, 'Meta no devolvió el código o la cuenta de WhatsApp; vuelve a intentarlo');
    const token = await signup.exchangeCode(code);
    if (!phoneId) {
      const numbers = await signup.phoneNumbers(wabaId, token);
      if (!numbers.length) throw new HttpError(400, 'La cuenta de WhatsApp no tiene números');
      phoneId = numbers[0].id;
    }
    const info = await signup.phoneInfo(phoneId, token).catch(() => ({}));
    await signup.subscribeApp(wabaId, token);
    db.transaction(() => {
      saveSetting.run('secret_wa_token', token);
      saveSetting.run('wa_phone_number_id', String(phoneId));
      saveSetting.run('wa_waba_id', String(wabaId));
      saveSetting.run('wa_display_phone', info.display_phone_number || '');
      saveSetting.run('wa_verified_name', info.verified_name || '');
      saveSetting.run('wa_coexistence', coexistence ? '1' : '0');
      saveSetting.run('wa_connected_at', new Date().toISOString());
    })();
    const sync = {};
    if (coexistence) {
      // Trae contactos e historial (últimos 6 meses) de la app del celular. Solo se permite en las primeras 24 h.
      for (const type of ['smb_app_state_sync', 'history']) {
        try { await signup.requestSync(phoneId, token, type); sync[type] = 'solicitado'; } catch (e) { sync[type] = e.message; }
      }
    }
    res.json({ ok: true, phoneNumberId: phoneId, wabaId, displayPhone: info.display_phone_number || null, sync });
  }));

  r.post('/whatsapp/disconnect', requireAdmin, (_req, res) => {
    db.prepare(`DELETE FROM settings WHERE key IN ('secret_wa_token','wa_phone_number_id','wa_waba_id','wa_display_phone',
      'wa_verified_name','wa_coexistence','wa_connected_at')`).run();
    res.json({ ok: true });
  });

  /** Bandeja: una fila por contacto con su último mensaje. */
  r.get('/whatsapp/conversations', (req, res) => {
    const { q, unread } = req.query;
    const where = ['m.id IS NOT NULL'];
    const params = {};
    if (q) { where.push('(c.name LIKE @q OR c.company LIKE @q OR c.phone LIKE @q)'); params.q = `%${q}%`; }
    if (unread === '1') where.push('c.unread_count > 0');
    const rows = db.prepare(`
      SELECT c.id, c.name, c.company, c.phone, c.status, c.type, c.unread_count, c.last_inbound_at, c.owner_id,
        m.body AS last_body, m.direction AS last_direction, m.status AS last_status, m.created_at AS last_at
      FROM contacts c
      LEFT JOIN wa_messages m ON m.id = (SELECT id FROM wa_messages WHERE contact_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1)
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC LIMIT 300`).all(params);
    res.json(rows.map((c) => ({ ...c, window_open: windowOpen(c) })));
  });

  r.get('/whatsapp/unread', (_req, res) => {
    res.json(db.prepare('SELECT COALESCE(SUM(unread_count),0) AS total FROM contacts').get());
  });

  r.get('/whatsapp/conversations/:contactId', (req, res) => {
    const c = db.prepare('SELECT id, name, company, phone, status, type, last_inbound_at, whatsapp_opt_in FROM contacts WHERE id = ?')
      .get(req.params.contactId);
    if (!c) throw new HttpError(404, 'Contacto no encontrado');
    const messages = db.prepare(`SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.contact_id = ? ORDER BY m.created_at ASC, m.id ASC`).all(c.id);
    res.json({ contact: { ...c, window_open: windowOpen(c) }, messages });
  });

  r.post('/whatsapp/conversations/:contactId/read', asyncHandler(async (req, res) => {
    const c = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.contactId);
    if (!c) throw new HttpError(404, 'Contacto no encontrado');
    db.prepare('UPDATE contacts SET unread_count = 0 WHERE id = ?').run(c.id);
    const last = db.prepare(`SELECT wa_message_id FROM wa_messages WHERE contact_id = ? AND direction = 'in' ORDER BY created_at DESC LIMIT 1`).get(c.id);
    if (last?.wa_message_id) await wa.markAsRead(last.wa_message_id);
    res.json({ ok: true });
  }));

  /** Mensaje libre (solo dentro de la ventana de 24 h). */
  r.post('/whatsapp/conversations/:contactId/send', asyncHandler(async (req, res) => {
    const c = contactOr404(req.params.contactId);
    const body = String(req.body?.body || '').trim();
    if (!body) throw new HttpError(400, 'Escribe un mensaje');
    if (!c.whatsapp_opt_in) throw new HttpError(400, 'El contacto no ha autorizado mensajes por WhatsApp');
    if (wa.configured && !windowOpen(c)) {
      throw new HttpError(409, 'Han pasado más de 24 h desde el último mensaje del cliente. Usa una plantilla aprobada para retomar la conversación.');
    }
    const sent = await wa.sendText(c.phone, body);
    const message = recordOutgoing(db, { contactId: c.id, waId: sent.id, type: 'text', body, simulated: sent.simulated, userId: req.user.id });
    res.status(201).json(message);
  }));

  /** Plantilla aprobada por Meta (para iniciar o retomar conversaciones). */
  r.post('/whatsapp/conversations/:contactId/template', asyncHandler(async (req, res) => {
    const c = contactOr404(req.params.contactId);
    const settings = getSettings(db);
    const { name, language = settings.wa_template_language || 'es_MX', params = [], preview } = req.body || {};
    if (!name) throw new HttpError(400, 'Indica el nombre de la plantilla');
    if (!c.whatsapp_opt_in) throw new HttpError(400, 'El contacto no ha autorizado mensajes por WhatsApp');
    const sent = await wa.sendTemplate(c.phone, name, language, params);
    const body = preview || `[plantilla: ${name}] ${params.join(' | ')}`.trim();
    const message = recordOutgoing(db, { contactId: c.id, waId: sent.id, type: 'template', body, simulated: sent.simulated, userId: req.user.id });
    db.prepare(`INSERT INTO activities (contact_id, type, subject, user_id, done, done_at) VALUES (?, 'whatsapp', ?, ?, 1, datetime('now'))`)
      .run(c.id, `Plantilla de WhatsApp enviada: ${name}`, req.user.id);
    res.status(201).json(message);
  }));

  r.get('/whatsapp/templates', asyncHandler(async (_req, res) => {
    const templates = await wa.listTemplates();
    res.json(templates.filter((t) => t.status === 'APPROVED'));
  }));

  /** Simula un mensaje entrante (útil para probar sin conectar Meta). */
  r.post('/whatsapp/simulate-incoming', asyncHandler(async (req, res) => {
    if (wa.configured && process.env.NODE_ENV === 'production') throw new HttpError(403, 'No disponible en producción');
    const { phone, name, body } = req.body || {};
    if (!phone || !body) throw new HttpError(400, 'Teléfono y mensaje son obligatorios');
    const from = String(phone).replace(/\D/g, '');
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: from, profile: { name: name || undefined } }],
        messages: [{ id: `sim-in-${Date.now()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
      } }] }],
    };
    res.json(await processWebhook(db, wa, payload));
  }));

  // ---- Respuestas rápidas ----
  r.get('/whatsapp/quick-replies', (_req, res) => res.json(db.prepare('SELECT * FROM quick_replies ORDER BY shortcut').all()));
  r.post('/whatsapp/quick-replies', (req, res) => {
    const { shortcut, body } = req.body || {};
    if (!shortcut || !body) throw new HttpError(400, 'Atajo y texto son obligatorios');
    const info = db.prepare('INSERT INTO quick_replies (shortcut, body) VALUES (?, ?)').run(shortcut, body);
    res.status(201).json(db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(info.lastInsertRowid));
  });
  r.delete('/whatsapp/quick-replies/:id', (req, res) => {
    db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
