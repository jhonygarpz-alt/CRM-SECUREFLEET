import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireAdmin } from '../auth.js';
import { getSettings } from '../db.js';
import { HttpError } from '../utils.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');
// Archivo público → [llave en BD, archivo predeterminado]
const FILES = {
  logo: ['logo', 'logo.jpeg', 'image/jpeg'],
  'icon-192.png': ['icon192', 'icon-192.png', 'image/png'],
  'icon-512.png': ['icon512', 'icon-512.png', 'image/png'],
};
const MAX_BYTES = 2 * 1024 * 1024;

/** Lee un recurso de marca: el subido por el administrador o el predeterminado. */
export function getBrandAsset(db, key) {
  const row = db.prepare('SELECT mime, data, updated_at FROM brand_assets WHERE key = ?').get(key);
  if (row) return row;
  const def = Object.values(FILES).find(([k]) => k === key);
  return { mime: def[2], data: fs.readFileSync(path.join(ASSETS, def[1])), updated_at: null };
}

function parseDataUrl(value, label) {
  const m = /^data:(image\/(png|jpeg));base64,(.+)$/.exec(String(value || ''));
  if (!m) throw new HttpError(400, `${label}: formato no válido (usa PNG o JPG)`);
  const data = Buffer.from(m[3], 'base64');
  if (data.length > MAX_BYTES) throw new HttpError(400, `${label}: el archivo supera 2 MB`);
  return { mime: m[1], data };
}

/** Rutas públicas: logo, íconos, manifiesto de la app instalable e información de marca. */
export function brandingPublicRoutes(db) {
  const r = Router();

  r.get('/branding/:file', (req, res, next) => {
    const def = FILES[req.params.file];
    if (!def) return next();
    const asset = getBrandAsset(db, def[0]);
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(asset.data);
  });

  r.get('/api/branding', (_req, res) => {
    const s = getSettings(db);
    const v = db.prepare('SELECT MAX(updated_at) AS v FROM brand_assets').get().v;
    res.json({
      name: s.company_name || 'SecureFleet',
      tagline: s.company_tagline || '',
      customLogo: Boolean(v),
      version: v ? String(new Date(v.replace(' ', 'T') + 'Z').getTime()) : '0',
    });
  });

  r.get('/manifest.webmanifest', (_req, res) => {
    const s = getSettings(db);
    const v = db.prepare('SELECT MAX(updated_at) AS v FROM brand_assets').get().v || '0';
    const q = `?v=${encodeURIComponent(v)}`;
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json({
      name: `${s.company_name || 'SecureFleet'} CRM`,
      short_name: s.company_name || 'CRM',
      description: 'CRM comercial: leads, pipeline, cotizaciones y WhatsApp',
      lang: 'es-MX',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#0a1f44',
      theme_color: '#0a1f44',
      icons: [
        { src: `/branding/icon-192.png${q}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/branding/icon-512.png${q}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/branding/icon-512.png${q}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'WhatsApp', url: '/whatsapp' },
        { name: 'Nueva cotización', url: '/cotizaciones/nueva' },
        { name: 'Seguimientos', url: '/seguimientos' },
      ],
    });
  });

  return r;
}

/** Rutas de administración del logo. */
export function brandingAdminRoutes(db) {
  const r = Router();
  const save = db.prepare(`INSERT INTO brand_assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`);

  /** Recibe el logo y los íconos ya redimensionados en el navegador (data URLs). */
  r.put('/branding/logo', requireAuth, requireAdmin, (req, res) => {
    const { logo, icon192, icon512 } = req.body || {};
    const assets = { logo: parseDataUrl(logo, 'Logo'), icon192: parseDataUrl(icon192, 'Ícono 192'), icon512: parseDataUrl(icon512, 'Ícono 512') };
    db.transaction(() => {
      for (const [key, a] of Object.entries(assets)) save.run(key, a.mime, a.data);
    })();
    res.json({ ok: true });
  });

  r.delete('/branding/logo', requireAuth, requireAdmin, (_req, res) => {
    db.prepare('DELETE FROM brand_assets').run();
    res.json({ ok: true });
  });

  return r;
}
