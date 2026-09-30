import 'dotenv/config';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb();
const app = createApp(db);
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`SecureFleet CRM escuchando en http://localhost:${port}`);
  if (!process.env.WHATSAPP_TOKEN) console.log('WhatsApp en MODO SIMULACIÓN (configura WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID)');
});
