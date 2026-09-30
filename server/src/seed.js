/**
 * Datos iniciales: catálogo base de SecureFleet y respuestas rápidas (seedCatalog),
 * y leads/oportunidades de ejemplo (seedDemo).
 * Los precios son ilustrativos: ajústalos desde el módulo de Catálogo.
 * Uso: npm run seed
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

export function seedCatalog(db) {

const products = [
  ['GPS-4G-BAS', 'Localizador GPS 4G básico', 'Equipo GPS 4G con reporte cada 30 s, corte de motor opcional y batería de respaldo.', 'producto', 'Hardware', 'pieza', 1890, 'unico'],
  ['GPS-4G-PRO', 'Localizador GPS 4G Pro', 'GPS 4G con entradas/salidas digitales, lectura de CAN bus y sensor de movimiento.', 'producto', 'Hardware', 'pieza', 2890, 'unico'],
  ['GPS-MOTO', 'Localizador GPS para motocicleta', 'Equipo compacto resistente al agua (IP67) para motocicletas y equipo menor.', 'producto', 'Hardware', 'pieza', 1590, 'unico'],
  ['DASHCAM-AI', 'Videocámara con IA (ADAS/DMS)', 'Cámara dual con detección de fatiga, distracción y colisión frontal.', 'producto', 'Video telemática', 'pieza', 6490, 'unico'],
  ['SENS-COMB', 'Sensor de combustible capacitivo', 'Sensor de nivel para monitoreo de consumo y detección de robo de combustible.', 'producto', 'Accesorios', 'pieza', 3200, 'unico'],
  ['BTN-PANICO', 'Botón de pánico', 'Botón inalámbrico con alerta inmediata a central y usuarios.', 'producto', 'Accesorios', 'pieza', 350, 'unico'],
  ['INST-STD', 'Instalación estándar', 'Instalación y configuración de equipo GPS en unidad ligera.', 'servicio', 'Instalación', 'servicio', 650, 'unico'],
  ['INST-PES', 'Instalación unidad pesada', 'Instalación en tractocamión o unidad pesada, incluye accesorios.', 'servicio', 'Instalación', 'servicio', 950, 'unico'],
  ['PLAT-MENS', 'Plataforma de rastreo - mensual', 'Acceso web y app, historial 90 días, alertas, geocercas y reportes.', 'servicio', 'Suscripción', 'unidad/mes', 299, 'mensual'],
  ['PLAT-ANUAL', 'Plataforma de rastreo - anual', 'Suscripción anual por unidad con 2 meses de descuento.', 'servicio', 'Suscripción', 'unidad/año', 2990, 'anual'],
  ['VIDEO-MENS', 'Servicio de video telemática - mensual', 'Transmisión de eventos en video y almacenamiento en la nube.', 'servicio', 'Suscripción', 'unidad/mes', 450, 'mensual'],
  ['MONIT-247', 'Monitoreo 24/7 con central', 'Monitoreo de alertas por operador, protocolo de robo y enlace con autoridades.', 'servicio', 'Suscripción', 'unidad/mes', 199, 'mensual'],
];
const insP = db.prepare(`INSERT OR IGNORE INTO products (sku, name, description, type, category, unit, price, billing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
for (const p of products) insP.run(...p);

const replies = [
  ['/saludo', 'Hola, gracias por contactar a SecureFleet 🚚📍 ¿Cuántas unidades te interesa rastrear y de qué tipo son?'],
  ['/demo', '¿Te gustaría agendar una demostración de la plataforma de 20 minutos? Dime qué día y horario te acomoda.'],
  ['/seguimiento', 'Hola, ¿pudiste revisar la cotización que te enviamos? Con gusto resuelvo cualquier duda.'],
  ['/instalacion', 'La instalación se realiza en tus instalaciones y toma aproximadamente 40 minutos por unidad.'],
];
if (db.prepare('SELECT COUNT(*) AS n FROM quick_replies').get().n === 0) {
  const insR = db.prepare('INSERT INTO quick_replies (shortcut, body) VALUES (?, ?)');
  for (const r of replies) insR.run(...r);
}
}

export function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n > 0) return;
  const insC = db.prepare(`INSERT INTO contacts (type, name, company, position, email, phone, source, status, fleet_size, city, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const c1 = insC.run('lead', 'Laura Méndez', 'Transportes del Bajío', 'Gerente de logística', 'laura@ejemplo.com', '5214771234567', 'Sitio web', 'calificado', 35, 'León').lastInsertRowid;
  const c2 = insC.run('lead', 'Carlos Ruiz', 'Distribuidora Ruiz', 'Director', 'carlos@ejemplo.com', '5215512345678', 'WhatsApp', 'nuevo', 8, 'CDMX').lastInsertRowid;
  const c3 = insC.run('cliente', 'Ana Torres', 'Constructora Torres', 'Compras', 'ana@ejemplo.com', '5213312345678', 'Referido', 'cliente', 12, 'Guadalajara').lastInsertRowid;
  const insD = db.prepare(`INSERT INTO deals (title, contact_id, stage, value, probability, units, expected_close, owner_id, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  insD.run('Rastreo flotilla 35 tractocamiones', c1, 'demo', 180000, 40, 35, null, null);
  insD.run('GPS para 8 camionetas de reparto', c2, 'prospecto', 25000, 10, 8, null, null);
  insD.run('GPS + dashcams obra', c3, 'ganado', 98000, 100, 12, null, new Date().toISOString().replace('T', ' ').slice(0, 19));
  const insA = db.prepare(`INSERT INTO activities (contact_id, type, subject, due_at, user_id) VALUES (?, ?, ?, ?, 1)`);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 11) + '10:00';
  insA.run(c1, 'demo', 'Demo de plataforma con equipo de logística', tomorrow);
  insA.run(c2, 'whatsapp', 'Dar seguimiento por WhatsApp y calificar necesidad', tomorrow);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  seedCatalog(db);
  seedDemo(db);
  console.log('Datos de ejemplo cargados.');
}
