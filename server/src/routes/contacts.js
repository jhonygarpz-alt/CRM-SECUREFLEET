import { Router } from 'express';
import { HttpError, pick, buildUpdate, normalizePhone } from '../utils.js';
import { LEAD_STATUSES } from '../constants.js';

const FIELDS = ['type', 'name', 'company', 'position', 'email', 'phone', 'whatsapp_opt_in', 'source', 'status',
  'fleet_size', 'city', 'tags', 'notes', 'owner_id'];

function clean(body) {
  const data = pick(body, FIELDS);
  if ('phone' in data) data.phone = normalizePhone(data.phone);
  if ('whatsapp_opt_in' in data) data.whatsapp_opt_in = data.whatsapp_opt_in ? 1 : 0;
  if (data.status && !LEAD_STATUSES.includes(data.status)) throw new HttpError(400, 'Estatus inválido');
  if (data.type && !['lead', 'cliente'].includes(data.type)) throw new HttpError(400, 'Tipo inválido');
  if (data.status === 'cliente') data.type = 'cliente';
  return data;
}

function uniqueGuard(fn) {
  try {
    return fn();
  } catch (e) {
    if (String(e.message).includes('UNIQUE') && String(e.message).includes('phone')) {
      throw new HttpError(409, 'Ya existe un contacto con ese teléfono');
    }
    throw e;
  }
}

export default function contactRoutes(db) {
  const r = Router();

  r.get('/contacts', (req, res) => {
    const { q, type, status, owner_id, source } = req.query;
    const where = [];
    const params = {};
    if (q) {
      where.push('(c.name LIKE @q OR c.company LIKE @q OR c.email LIKE @q OR c.phone LIKE @q OR c.tags LIKE @q)');
      params.q = `%${q}%`;
    }
    if (type) { where.push('c.type = @type'); params.type = type; }
    if (status) { where.push('c.status = @status'); params.status = status; }
    if (source) { where.push('c.source = @source'); params.source = source; }
    if (owner_id) { where.push('c.owner_id = @owner_id'); params.owner_id = owner_id; }
    const rows = db.prepare(`
      SELECT c.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('ganado','perdido')) AS open_deals,
        (SELECT MIN(a.due_at) FROM activities a WHERE a.contact_id = c.id AND a.done = 0 AND a.due_at IS NOT NULL) AS next_followup
      FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.updated_at DESC LIMIT 1000`).all(params);
    res.json(rows);
  });

  r.get('/contacts/:id', (req, res) => {
    const c = db.prepare('SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?')
      .get(req.params.id);
    if (!c) throw new HttpError(404, 'Contacto no encontrado');
    c.deals = db.prepare('SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC').all(c.id);
    c.quotes = db.prepare('SELECT id, folio, status, total, currency, issue_date, valid_until FROM quotes WHERE contact_id = ? ORDER BY id DESC').all(c.id);
    c.activities = db.prepare(`SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.contact_id = ? ORDER BY COALESCE(a.due_at, a.created_at) DESC`).all(c.id);
    res.json(c);
  });

  r.post('/contacts', (req, res) => {
    const data = clean(req.body || {});
    if (!data.name) throw new HttpError(400, 'El nombre es obligatorio');
    if (data.owner_id === undefined) data.owner_id = req.user.id;
    const keys = Object.keys(data);
    const info = uniqueGuard(() => db.prepare(
      `INSERT INTO contacts (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(data));
    res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/contacts/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Contacto no encontrado');
    const data = clean(req.body || {});
    if ('name' in data && !data.name) throw new HttpError(400, 'El nombre es obligatorio');
    data.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const upd = buildUpdate('contacts', existing.id, data);
    uniqueGuard(() => db.prepare(upd.sql).run(upd.params));
    res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id));
  });

  r.delete('/contacts/:id', (req, res) => {
    const info = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Contacto no encontrado');
    res.json({ ok: true });
  });

  /** Importación masiva: [{ name, company, phone, email, ... }] */
  r.post('/contacts/import', (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    if (!Array.isArray(rows)) throw new HttpError(400, 'Se esperaba una lista de contactos');
    let created = 0;
    const skipped = [];
    const tx = db.transaction(() => {
      rows.forEach((row, i) => {
        try {
          const data = clean(row);
          if (!data.name) throw new Error('sin nombre');
          if (data.phone && db.prepare('SELECT 1 FROM contacts WHERE phone = ?').get(data.phone)) throw new Error('teléfono duplicado');
          data.owner_id ??= req.user.id;
          data.source ??= 'Importación';
          const keys = Object.keys(data);
          db.prepare(`INSERT INTO contacts (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(data);
          created++;
        } catch (e) {
          skipped.push({ row: i + 1, reason: e.message });
        }
      });
    });
    tx();
    res.json({ created, skipped });
  });

  return r;
}
