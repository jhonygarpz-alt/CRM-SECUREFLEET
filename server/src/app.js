import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';
import { HttpError } from './utils.js';
import { createDynamicWhatsAppClient, createSignupClient } from './services/whatsapp.js';
import authRoutes from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import dealRoutes from './routes/deals.js';
import productRoutes from './routes/products.js';
import quoteRoutes from './routes/quotes.js';
import activityRoutes from './routes/activities.js';
import dashboardRoutes from './routes/dashboard.js';
import settingsRoutes from './routes/settings.js';
import legalRoutes from './routes/legal.js';
import { brandingPublicRoutes, brandingAdminRoutes } from './routes/branding.js';
import { whatsappRoutes, whatsappWebhookRoutes } from './routes/whatsapp.js';

export function createApp(db, { wa = createDynamicWhatsAppClient(db), signup = createSignupClient() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
  // Guardamos el cuerpo crudo para validar la firma de los webhooks de Meta.
  app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, whatsapp: wa.configured ? 'live' : 'simulacion' }));

  // Rutas públicas
  app.use(brandingPublicRoutes(db));
  app.use('/api', brandingAdminRoutes(db));
  app.use('/api', whatsappWebhookRoutes(db, wa));
  app.use('/api', authRoutes(db));

  // Rutas protegidas
  const api = express.Router();
  api.use(requireAuth);
  api.use(contactRoutes(db));
  api.use(dealRoutes(db));
  api.use(productRoutes(db));
  api.use(quoteRoutes(db, wa));
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(settingsRoutes(db));
  api.use(whatsappRoutes(db, wa, signup));
  app.use('/api', api);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // Páginas públicas legales (Meta las pide para la app de WhatsApp)
  app.use(legalRoutes(db));

  // Frontend compilado (client/dist) en producción
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const generic = status === 500 && !(err instanceof HttpError);
    res.status(status).json({ error: generic ? 'Error interno del servidor' : err.message });
  });

  return app;
}
