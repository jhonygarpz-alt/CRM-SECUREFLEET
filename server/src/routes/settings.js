import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { getSettings, DEFAULT_SETTINGS } from '../db.js';

export default function settingsRoutes(db) {
  const r = Router();
  r.get('/settings', (_req, res) => res.json(getSettings(db)));
  r.put('/settings', requireAdmin, (req, res) => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(req.body || {})) {
      if (k in DEFAULT_SETTINGS) up.run(k, v == null ? '' : String(v));
    }
    res.json(getSettings(db));
  });
  return r;
}
