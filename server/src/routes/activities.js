import { Router } from 'express';
import { HttpError, pick, buildUpdate } from '../utils.js';
import { ACTIVITY_TYPES } from '../constants.js';

const FIELDS = ['contact_id', 'deal_id', 'type', 'subject', 'notes', 'due_at', 'done', 'user_id'];

export default function activityRoutes(db) {
  const r = Router();
  const get = (id) => db.prepare(`SELECT a.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
      u.name AS user_name FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = ?`).get(id);

  /** filter: pendientes | vencidas | hoy | completadas */
  r.get('/activities', (req, res) => {
    const { filter, contact_id, user_id } = req.query;
    const where = [];
    const params = {};
    if (contact_id) { where.push('a.contact_id = @contact_id'); params.contact_id = contact_id; }
    if (user_id) { where.push('a.user_id = @user_id'); params.user_id = user_id; }
    if (filter === 'pendientes') where.push('a.done = 0');
    if (filter === 'completadas') where.push('a.done = 1');
    if (filter === 'vencidas') where.push("a.done = 0 AND a.due_at IS NOT NULL AND a.due_at < strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')");
    if (filter === 'hoy') where.push("a.done = 0 AND date(a.due_at) = date('now', 'localtime')");
    res.json(db.prepare(`SELECT a.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
        u.name AS user_name FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY a.done ASC, CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at ASC, a.created_at DESC LIMIT 500`).all(params));
  });

  r.post('/activities', (req, res) => {
    const data = pick(req.body || {}, FIELDS);
    if (!data.subject) throw new HttpError(400, 'El asunto es obligatorio');
    if (data.type && !ACTIVITY_TYPES.includes(data.type)) throw new HttpError(400, 'Tipo de actividad inválido');
    data.user_id ??= req.user.id;
    data.done = data.done ? 1 : 0;
    if (data.done) data.done_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const keys = Object.keys(data);
    const info = db.prepare(`INSERT INTO activities (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(data);
    if (data.contact_id && data.done && ['llamada', 'whatsapp', 'email', 'reunion', 'demo'].includes(data.type)) {
      db.prepare(`UPDATE contacts SET last_contact_at = datetime('now'),
          status = CASE WHEN status = 'nuevo' THEN 'contactado' ELSE status END WHERE id = ?`).run(data.contact_id);
    }
    res.status(201).json(get(info.lastInsertRowid));
  });

  r.put('/activities/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
    if (!a) throw new HttpError(404, 'Actividad no encontrada');
    const data = pick(req.body || {}, FIELDS);
    if ('done' in data) {
      data.done = data.done ? 1 : 0;
      data.done_at = data.done ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
    }
    const upd = buildUpdate('activities', a.id, data);
    if (upd) db.prepare(upd.sql).run(upd.params);
    res.json(get(a.id));
  });

  r.delete('/activities/:id', (req, res) => {
    const info = db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Actividad no encontrada');
    res.json({ ok: true });
  });

  return r;
}
