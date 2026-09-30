import { Router } from 'express';
import { HttpError, asyncHandler } from '../utils.js';
import { getSettings } from '../db.js';
import { QUOTE_STATUSES } from '../constants.js';
import { computeQuote, renderQuotePdf, money } from '../services/quotes.js';
import { recordOutgoing, windowOpen } from '../services/messaging.js';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => {
  const date = new Date(d + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

export default function quoteRoutes(db, wa) {
  const r = Router();

  const load = (id) => {
    const q = db.prepare(`SELECT q.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
        c.email AS contact_email, d.title AS deal_title, u.name AS created_by_name
        FROM quotes q JOIN contacts c ON c.id = q.contact_id LEFT JOIN deals d ON d.id = q.deal_id
        LEFT JOIN users u ON u.id = q.created_by WHERE q.id = ?`).get(id);
    if (!q) throw new HttpError(404, 'Cotización no encontrada');
    q.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position').all(q.id);
    return q;
  };

  const nextFolio = (prefix) => {
    const year = new Date().getFullYear();
    const like = `${prefix}-${year}-%`;
    const last = db.prepare('SELECT folio FROM quotes WHERE folio LIKE ? ORDER BY id DESC LIMIT 1').get(like);
    const n = last ? Number(last.folio.split('-').pop()) + 1 : 1;
    return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
  };

  const saveItems = (quoteId, lines) => {
    db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
    const ins = db.prepare(`INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, discount_pct,
        tax_rate, billing, line_subtotal, line_total, position) VALUES (@quote_id, @product_id, @description, @quantity,
        @unit_price, @discount_pct, @tax_rate, @billing, @line_subtotal, @line_total, @position)`);
    for (const l of lines) ins.run({ ...l, quote_id: quoteId });
  };

  r.get('/quotes', (req, res) => {
    const { status, contact_id, q } = req.query;
    const where = [];
    const params = {};
    if (status) { where.push('q.status = @status'); params.status = status; }
    if (contact_id) { where.push('q.contact_id = @contact_id'); params.contact_id = contact_id; }
    if (q) { where.push('(q.folio LIKE @q OR c.name LIKE @q OR c.company LIKE @q)'); params.q = `%${q}%`; }
    // Marca como vencidas las cotizaciones enviadas cuya vigencia ya pasó.
    db.prepare(`UPDATE quotes SET status = 'vencida' WHERE status = 'enviada' AND valid_until < date('now','localtime')`).run();
    res.json(db.prepare(`SELECT q.*, c.name AS contact_name, c.company AS contact_company, u.name AS created_by_name
        FROM quotes q JOIN contacts c ON c.id = q.contact_id LEFT JOIN users u ON u.id = q.created_by
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC`).all(params));
  });

  r.get('/quotes/:id', (req, res) => res.json(load(req.params.id)));

  const upsert = (req, existing) => {
    const settings = getSettings(db);
    const body = req.body || {};
    const contactId = body.contact_id ?? existing?.contact_id;
    if (!contactId || !db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(contactId)) throw new HttpError(400, 'Selecciona un contacto válido');
    const items = Array.isArray(body.items) ? body.items : existing?.items || [];
    if (!items.length) throw new HttpError(400, 'Agrega al menos una partida');
    if (body.status && !QUOTE_STATUSES.includes(body.status)) throw new HttpError(400, 'Estatus inválido');
    const calc = computeQuote(items);
    const issue = body.issue_date || existing?.issue_date || today();
    const data = {
      contact_id: contactId,
      deal_id: body.deal_id === undefined ? existing?.deal_id ?? null : body.deal_id || null,
      status: body.status || existing?.status || 'borrador',
      issue_date: issue,
      valid_until: body.valid_until || existing?.valid_until || addDays(issue, Number(settings.quote_validity_days) || 15),
      currency: body.currency || existing?.currency || settings.default_currency || 'MXN',
      title: body.title === undefined ? existing?.title ?? null : body.title || null,
      notes: body.notes === undefined ? existing?.notes ?? null : body.notes,
      terms: body.terms === undefined ? existing?.terms ?? settings.quote_terms : body.terms,
      subtotal: calc.subtotal,
      discount_total: calc.discount_total,
      tax_total: calc.tax_total,
      total: calc.total,
      recurring_total: calc.recurring_total,
    };
    return { data, lines: calc.lines, settings };
  };

  r.post('/quotes', (req, res) => {
    const { data, lines, settings } = upsert(req);
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO quotes (folio, contact_id, deal_id, status, issue_date, valid_until, currency, title, notes, terms,
          subtotal, discount_total, tax_total, total, recurring_total, created_by) VALUES (@folio, @contact_id, @deal_id, @status,
          @issue_date, @valid_until, @currency, @title, @notes, @terms, @subtotal, @discount_total, @tax_total, @total, @recurring_total, @created_by)`)
        .run({ ...data, folio: nextFolio(settings.quote_prefix || 'COT'), created_by: req.user.id });
      saveItems(info.lastInsertRowid, lines);
      if (data.deal_id) {
        db.prepare(`UPDATE deals SET value = ?, stage = CASE WHEN stage IN ('prospecto','contactado','demo') THEN 'propuesta' ELSE stage END,
            updated_at = datetime('now') WHERE id = ?`).run(data.subtotal - data.discount_total, data.deal_id);
      }
      return info.lastInsertRowid;
    })();
    res.status(201).json(load(id));
  });

  r.put('/quotes/:id', (req, res) => {
    const existing = load(req.params.id);
    const { data, lines } = upsert(req, existing);
    db.transaction(() => {
      db.prepare(`UPDATE quotes SET contact_id=@contact_id, deal_id=@deal_id, status=@status, issue_date=@issue_date,
          valid_until=@valid_until, currency=@currency, title=@title, notes=@notes, terms=@terms, subtotal=@subtotal,
          discount_total=@discount_total, tax_total=@tax_total, total=@total, recurring_total=@recurring_total,
          updated_at=datetime('now') WHERE id=@id`).run({ ...data, id: existing.id });
      saveItems(existing.id, lines);
      if (data.status === 'aceptada' && existing.status !== 'aceptada' && data.deal_id) {
        db.prepare(`UPDATE deals SET stage='ganado', probability=100, closed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(data.deal_id);
        db.prepare(`UPDATE contacts SET type='cliente', status='cliente' WHERE id=?`).run(data.contact_id);
      }
    })();
    res.json(load(existing.id));
  });

  r.post('/quotes/:id/duplicate', (req, res) => {
    const src = load(req.params.id);
    const settings = getSettings(db);
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO quotes (folio, contact_id, deal_id, status, issue_date, valid_until, currency, title, notes, terms,
          subtotal, discount_total, tax_total, total, recurring_total, created_by) VALUES (?, ?, ?, 'borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nextFolio(settings.quote_prefix || 'COT'), src.contact_id, src.deal_id, today(),
          addDays(today(), Number(settings.quote_validity_days) || 15), src.currency, src.title, src.notes, src.terms, src.subtotal,
          src.discount_total, src.tax_total, src.total, src.recurring_total, req.user.id);
      saveItems(info.lastInsertRowid, src.items);
      return info.lastInsertRowid;
    })();
    res.status(201).json(load(id));
  });

  r.delete('/quotes/:id', (req, res) => {
    const info = db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Cotización no encontrada');
    res.json({ ok: true });
  });

  const buildPdf = async (quote) => {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(quote.contact_id);
    const seller = quote.created_by ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(quote.created_by) : null;
    return renderQuotePdf({ quote, items: quote.items, contact, settings: getSettings(db), seller });
  };

  r.get('/quotes/:id/pdf', asyncHandler(async (req, res) => {
    const quote = load(req.params.id);
    const pdf = await buildPdf(quote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.folio}.pdf"`);
    res.send(pdf);
  }));

  /** Envía el PDF de la cotización al cliente por WhatsApp. */
  r.post('/quotes/:id/send-whatsapp', asyncHandler(async (req, res) => {
    const quote = load(req.params.id);
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(quote.contact_id);
    if (!contact.phone) throw new HttpError(400, 'El contacto no tiene teléfono de WhatsApp');
    if (!windowOpen(contact) && wa.configured) {
      throw new HttpError(409,
        'La ventana de 24 h está cerrada: WhatsApp solo permite enviar documentos si el cliente te escribió en las últimas 24 horas. ' +
        'Envía primero una plantilla de seguimiento desde el chat y reintenta cuando responda.');
    }
    const settings = getSettings(db);
    const firstName = contact.name.split(' ')[0];
    const caption = req.body?.message ||
      `Hola ${firstName}, te comparto la cotización ${quote.folio} de ${settings.company_name} por ${money(quote.total, quote.currency)}. ` +
      `Vigente hasta ${quote.valid_until}. Quedo atento a tus comentarios.`;
    const pdf = await buildPdf(quote);
    const sent = await wa.sendDocument(contact.phone, pdf, `${quote.folio}.pdf`, caption);
    const message = recordOutgoing(db, {
      contactId: contact.id, waId: sent.id, type: 'document', body: caption, mediaId: sent.mediaId,
      filename: `${quote.folio}.pdf`, simulated: sent.simulated, userId: req.user.id,
    });
    db.prepare(`UPDATE quotes SET status = CASE WHEN status = 'borrador' THEN 'enviada' ELSE status END, sent_at = datetime('now') WHERE id = ?`).run(quote.id);
    db.prepare(`INSERT INTO activities (contact_id, deal_id, type, subject, user_id, done, done_at) VALUES (?, ?, 'whatsapp', ?, ?, 1, datetime('now'))`)
      .run(contact.id, quote.deal_id, `Cotización ${quote.folio} enviada por WhatsApp`, req.user.id);
    res.json({ ok: true, simulated: sent.simulated, message, quote: load(quote.id) });
  }));

  return r;
}
