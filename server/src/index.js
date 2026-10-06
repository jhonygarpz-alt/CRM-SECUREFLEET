import 'dotenv/config';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedCatalog } from './seed.js';
import { createDynamicWhatsAppClient } from './services/whatsapp.js';

// En producción (nube) no se permite arrancar con claves por defecto.
if (process.env.NODE_ENV === 'production') {
  const missing = ['JWT_SECRET', 'ADMIN_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Faltan variables de entorno obligatorias en producción: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.ADMIN_PASSWORD.length < 8) {
    console.error('ADMIN_PASSWORD debe tener al menos 8 caracteres');
    process.exit(1);
  }
}

const db = openDb();
if (process.env.LOAD_CATALOG === '1' && db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  seedCatalog(db);
  console.log('Catálogo base cargado.');
}
const wa = createDynamicWhatsAppClient(db);
if (wa.provider === 'waweb') wa.start();
const app = createApp(db, { wa });
app.locals.campaigns.start(); // envío de campañas en segundo plano
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`SecureFleet CRM escuchando en el puerto ${port}`);
  console.log(`WhatsApp: ${wa.provider === 'waweb' ? 'modo WhatsApp Web (QR en Configuración)' : wa.configured ? wa.provider : 'MODO SIMULACIÓN'}`);
});
