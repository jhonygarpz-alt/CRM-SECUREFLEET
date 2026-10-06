import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ventas' CHECK (role IN ('admin','ventas')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'lead' CHECK (type IN ('lead','cliente')),
  name TEXT NOT NULL,
  company TEXT,
  position TEXT,
  email TEXT,
  phone TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'nuevo',
  fleet_size INTEGER,
  city TEXT,
  tags TEXT,
  notes TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_contact_at TEXT,
  last_inbound_at TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'prospecto',
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  probability INTEGER,
  units INTEGER,
  expected_close TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  lost_reason TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'producto' CHECK (type IN ('producto','servicio')),
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pieza',
  price REAL NOT NULL DEFAULT 0,
  cost REAL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  billing TEXT NOT NULL DEFAULT 'unico' CHECK (billing IN ('unico','mensual','anual')),
  tax_rate REAL NOT NULL DEFAULT 0.16,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'borrador',
  issue_date TEXT NOT NULL DEFAULT (date('now')),
  valid_until TEXT,
  currency TEXT NOT NULL DEFAULT 'MXN',
  notes TEXT,
  terms TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  recurring_total REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.16,
  billing TEXT NOT NULL DEFAULT 'unico',
  line_subtotal REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'tarea',
  subject TEXT NOT NULL,
  notes TEXT,
  due_at TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  wa_message_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_id TEXT,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_contact ON wa_messages(contact_id, created_at);

CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcut TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_assets (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export const DEFAULT_SETTINGS = {
  company_name: 'SecureFleet',
  company_legal_name: '',
  company_rfc: '',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_website: '',
  default_currency: 'MXN',
  default_tax_rate: '0.16',
  quote_validity_days: '15',
  quote_prefix: 'SF-COT',
  quote_terms: [
    'Precios sujetos a cambio sin previo aviso y válidos durante la vigencia indicada.',
    'Los servicios mensuales se facturan por adelantado y su vigencia está sujeta a la continuidad del contrato de servicio.',
    'La instalación está sujeta a la disponibilidad de agenda y de las unidades.',
    'Cualquier equipo, servicio o desarrollo adicional fuera de este alcance se cotizará por separado.',
  ].join('\n'),
  company_tagline: 'FLEET INTELLIGENCE',
  company_slogan: 'Seguridad Patrimonial y Monitoreo de Flotas',
  quote_label_initial: 'INVERSIÓN INICIAL',
  quote_label_monthly: 'SERVICIO MENSUAL',
  quote_label_annual: 'SERVICIO ANUAL',
  wa_auto_create_leads: '1',
  wa_welcome_message: '',
  wa_followup_template: '',
  wa_template_language: 'es_MX',
};

export function openDb(file = process.env.DB_PATH || './data/crm.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Unifica teléfonos mexicanos guardados como 521XXXXXXXXXX → 52XXXXXXXXXX.
  db.exec(`UPDATE OR IGNORE contacts SET phone = '52' || substr(phone, 4)
           WHERE length(phone) = 13 AND phone LIKE '521%'`);

  // Migraciones ligeras
  const quoteCols = db.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name);
  if (!quoteCols.includes('title')) db.exec('ALTER TABLE quotes ADD COLUMN title TEXT');
  const msgCols = db.prepare('PRAGMA table_info(wa_messages)').all().map((c) => c.name);
  if (!msgCols.includes('media_mime')) db.exec('ALTER TABLE wa_messages ADD COLUMN media_mime TEXT');
  if (!msgCols.includes('media_path')) db.exec('ALTER TABLE wa_messages ADD COLUMN media_path TEXT');

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@securefleet.mx';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      'Administrador',
      email.toLowerCase(),
      bcrypt.hashSync(password, 10),
      'admin',
    );
  }
  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Carpeta donde se guardan audios, imágenes y documentos de WhatsApp (junto a la base de datos). */
export function mediaDir() {
  const file = process.env.DB_PATH || './data/crm.db';
  const base = file === ':memory:' ? path.resolve('./data') : path.dirname(path.resolve(file));
  return path.join(base, 'media');
}
