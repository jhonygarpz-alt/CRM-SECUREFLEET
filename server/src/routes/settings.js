import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { getSettings, DEFAULT_SETTINGS } from '../db.js';

// Las llaves secret_* (ej. el token de WhatsApp) nunca se envían al navegador.
const publicSettings = (db) => Object.fromEntries(Object.entries(getSettings(db)).filter(([k]) => !k.startsWith('secret_')));

export default function settingsRoutes(db) {
  const r = Router();
  r.get('/settings', (_req, res) => res.json(publicSettings(db)));
  r.put('/settings', requireAdmin, (req, res) => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(req.body || {})) {
      if (k in DEFAULT_SETTINGS) up.run(k, v == null ? '' : String(v));
    }
    res.json(publicSettings(db));
  });
  return r;
}
