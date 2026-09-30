import { Router } from 'express';
import { HttpError, pick, buildUpdate } from '../utils.js';
import { DEAL_STAGES, STAGE_PROBABILITY } from '../constants.js';

const FIELDS = ['title', 'contact_id', 'stage', 'value', 'currency', 'probability', 'units', 'expected_close', 'owner_id', 'notes', 'lost_reason'];
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export default function dealRoutes(db) {
  const r = Router();
  const getDeal = (id) => db.prepare(`SELECT d.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
      u.name AS owner_name FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.id = ?`).get(id);

  r.get('/deals', (req, res) => {
    const { stage, owner_id, contact_id } = req.query;
    const where = [];
    const params = {};
    if (stage) { where.push('d.stage = @stage'); params.stage = stage; }
    if (owner_id) { where.push('d.owner_id = @owner_id'); params.owner_id = owner_id; }
    if (contact_id) { where.push('d.contact_id = @contact_id'); params.contact_id = contact_id; }
    res.json(db.prepare(`SELECT d.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
        u.name AS owner_name FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.updated_at DESC`).all(params));
  });

  r.get('/deals/:id', (req, res) => {
    const d = getDeal(req.params.id);
    if (!d) throw new HttpError(404, 'Oportunidad no encontrada');
    d.quotes = db.prepare('SELECT id, folio, status, total, currency FROM quotes WHERE deal_id = ? ORDER BY id DESC').all(d.id);
    d.activities = db.prepare('SELECT * FROM activities WHERE deal_id = ? ORDER BY created_at DESC').all(d.id);
    res.json(d);
  });

  r.post('/deals', (req, res) => {
    const data = pick(req.body || {}, FIELDS);
    if (!data.title || !data.contact_id) throw new HttpError(400, 'Título y contacto son obligatorios');
    if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(data.contact_id)) throw new HttpError(400, 'Contacto inexistente');
    data.stage ||= 'prospecto';
    if (!DEAL_STAGES.includes(data.stage)) throw new HttpError(400, 'Etapa inválida');
    data.probability ??= STAGE_PROBABILITY[data.stage];
    data.owner_id ??= req.user.id;
    const keys = Object.keys(data);
    const info = db.prepare(`INSERT INTO deals (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(data);
    db.prepare(`UPDATE contacts SET status = CASE WHEN status = 'nuevo' THEN 'contactado' ELSE status END WHERE id = ?`).run(data.contact_id);
    res.status(201).json(getDeal(info.lastInsertRowid));
  });

  r.put('/deals/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Oportunidad no encontrada');
    const data = pick(req.body || {}, FIELDS);
    if (data.stage && !DEAL_STAGES.includes(data.stage)) throw new HttpError(400, 'Etapa inválida');
    if (data.stage && data.stage !== existing.stage) {
      if (req.body.probability === undefined) data.probability = STAGE_PROBABILITY[data.stage];
      data.closed_at = ['ganado', 'perdido'].includes(data.stage) ? now() : null;
      db.prepare(`INSERT INTO activities (contact_id, deal_id, type, subject, user_id, done, done_at)
          VALUES (?, ?, 'nota', ?, ?, 1, datetime('now'))`)
        .run(existing.contact_id, existing.id, `Etapa cambiada: ${existing.stage} → ${data.stage}`, req.user.id);
      if (data.stage === 'ganado') {
        db.prepare(`UPDATE contacts SET type = 'cliente', status = 'cliente', updated_at = datetime('now') WHERE id = ?`).run(existing.contact_id);
      }
    }
    data.updated_at = now();
    const upd = buildUpdate('deals', existing.id, data);
    db.prepare(upd.sql).run(upd.params);
    res.json(getDeal(existing.id));
  });

  r.delete('/deals/:id', (req, res) => {
    const info = db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Oportunidad no encontrada');
    res.json({ ok: true });
  });

  return r;
}
