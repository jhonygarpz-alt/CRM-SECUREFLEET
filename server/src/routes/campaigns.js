import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../utils.js';
import { mediaDir } from '../db.js';

const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE = 5 * 1024 * 1024;

/** Campañas: enviar un mensaje (con imagen opcional) a varios leads, de forma espaciada. */
export default function campaignRoutes(db, runner) {
  const r = Router();

  const counts = (id) => Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM campaign_recipients
      WHERE campaign_id = ? GROUP BY status`).all(id).map((x) => [x.status, x.n]));
  const load = (id) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) throw new HttpError(404, 'Campaña no encontrada');
    return { ...c, counts: counts(c.id) };
  };

  r.get('/campaigns', (_req, res) => {
    const rows = db.prepare(`SELECT c.*, u.name AS created_by_name FROM campaigns c LEFT JOIN users u ON u.id = c.created_by
        ORDER BY c.id DESC`).all();
    res.json({
      campaigns: rows.map((c) => ({ ...c, counts: counts(c.id) })),
      sentToday: runner.sentToday(),
      nextSendAt: runner.nextSendAt(),
    });
  });

  r.get('/campaigns/:id', (req, res) => {
    const c = load(req.params.id);
    c.recipients = db.prepare(`SELECT r.*, ct.name, ct.company, ct.phone FROM campaign_recipients r
        JOIN contacts ct ON ct.id = r.contact_id WHERE r.campaign_id = ? ORDER BY r.id`).all(c.id);
    c.nextSendAt = runner.nextSendAt();
    c.sentToday = runner.sentToday();
    res.json(c);
  });

  r.get('/campaigns/:id/media', (req, res) => {
    const c = load(req.params.id);
    if (!c.media_path) throw new HttpError(404, 'Sin imagen');
    res.setHeader('Content-Type', c.media_mime);
    fs.createReadStream(path.join(mediaDir(), path.basename(c.media_path))).pipe(res);
  });

  r.post('/campaigns', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const body = String(b.body || '').trim();
    if (!name || !body) throw new HttpError(400, 'Escribe un nombre y el mensaje de la campaña');
    const ids = [...new Set((b.contact_ids || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, 'Selecciona al menos un destinatario');
    const minDelay = Math.max(15, Number(b.min_delay) || 45);
    const maxDelay = Math.max(minDelay, Number(b.max_delay) || 120);
    const dailyLimit = Math.min(200, Math.max(1, Number(b.daily_limit) || 30));

    // Imagen: subida (data URL) o copiada de un mensaje existente del chat.
    let media = null;
    if (b.image) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.image));
      if (!m) throw new HttpError(400, 'La imagen debe ser JPG, PNG o WEBP');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_IMAGE) throw new HttpError(400, 'La imagen supera 5 MB');
      media = { mime: m[1], buf };
    } else if (b.from_message_id) {
      const msg = db.prepare('SELECT media_path, media_mime FROM wa_messages WHERE id = ?').get(b.from_message_id);
      if (msg?.media_path && String(msg.media_mime).startsWith('image/')) {
        const file = path.join(mediaDir(), path.basename(msg.media_path));
        if (fs.existsSync(file)) media = { mime: msg.media_mime.split(';')[0], buf: fs.readFileSync(file) };
      }
    }

    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO campaigns (name, body, status, min_delay, max_delay, daily_limit, created_by)
          VALUES (?, ?, 'borrador', ?, ?, ?, ?)`).run(name, body, minDelay, maxDelay, dailyLimit, req.user.id);
      const ins = db.prepare('INSERT OR IGNORE INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)');
      for (const cid of ids) ins.run(info.lastInsertRowid, cid);
      return info.lastInsertRowid;
    })();
    if (media) {
      const fileName = `campana-${id}.${IMG_EXT[media.mime] || 'jpg'}`;
      fs.mkdirSync(mediaDir(), { recursive: true });
      fs.writeFileSync(path.join(mediaDir(), fileName), media.buf);
      db.prepare('UPDATE campaigns SET media_path = ?, media_mime = ? WHERE id = ?').run(fileName, media.mime, id);
    }
    res.status(201).json(load(id));
  });

  const setStatus = (from, to, extra = '') => (req, res) => {
    const c = load(req.params.id);
    if (!from.includes(c.status)) throw new HttpError(400, `No se puede pasar de "${c.status}" a "${to}"`);
    db.prepare(`UPDATE campaigns SET status = ?${extra} WHERE id = ?`).run(to, c.id);
    if (to === 'enviando') runner.resetDelay();
    res.json(load(c.id));
  };
  r.post('/campaigns/:id/start', setStatus(['borrador', 'pausada'], 'enviando', ", started_at = COALESCE(started_at, datetime('now'))"));
  r.post('/campaigns/:id/pause', setStatus(['enviando'], 'pausada'));
  r.post('/campaigns/:id/cancel', setStatus(['borrador', 'enviando', 'pausada'], 'cancelada', ", finished_at = datetime('now')"));

  r.delete('/campaigns/:id', (req, res) => {
    const c = load(req.params.id);
    if (c.status === 'enviando') throw new HttpError(400, 'Pausa o cancela la campaña antes de borrarla');
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  /** Datos de un mensaje del chat, para usarlo como base de una campaña ("Reenviar a varios"). */
  r.get('/whatsapp/messages/:id', (req, res) => {
    const m = db.prepare('SELECT id, type, body, media_mime, media_path FROM wa_messages WHERE id = ?').get(req.params.id);
    if (!m) throw new HttpError(404, 'Mensaje no encontrado');
    res.json(m);
  });

  return r;
}
