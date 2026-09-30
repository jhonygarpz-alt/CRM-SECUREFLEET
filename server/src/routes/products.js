import { Router } from 'express';
import { HttpError, pick, buildUpdate } from '../utils.js';

const FIELDS = ['sku', 'name', 'description', 'type', 'category', 'unit', 'price', 'cost', 'currency', 'billing', 'tax_rate', 'active'];

function clean(body) {
  const data = pick(body, FIELDS);
  if ('active' in data) data.active = data.active ? 1 : 0;
  if (data.type && !['producto', 'servicio'].includes(data.type)) throw new HttpError(400, 'Tipo inválido');
  if (data.billing && !['unico', 'mensual', 'anual'].includes(data.billing)) throw new HttpError(400, 'Periodicidad inválida');
  if ('price' in data && (isNaN(Number(data.price)) || Number(data.price) < 0)) throw new HttpError(400, 'Precio inválido');
  return data;
}

const guard = (fn) => {
  try { return fn(); } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un producto con ese SKU');
    throw e;
  }
};

export default function productRoutes(db) {
  const r = Router();

  r.get('/products', (req, res) => {
    const { q, type, category, active } = req.query;
    const where = [];
    const params = {};
    if (q) { where.push('(name LIKE @q OR sku LIKE @q OR description LIKE @q)'); params.q = `%${q}%`; }
    if (type) { where.push('type = @type'); params.type = type; }
    if (category) { where.push('category = @category'); params.category = category; }
    if (active !== undefined && active !== '') { where.push('active = @active'); params.active = Number(active); }
    res.json(db.prepare(`SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name`).all(params));
  });

  r.get('/products/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    res.json(p);
  });

  r.post('/products', (req, res) => {
    const data = clean(req.body || {});
    if (!data.name) throw new HttpError(400, 'El nombre es obligatorio');
    const keys = Object.keys(data);
    const info = guard(() => db.prepare(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(data));
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/products/:id', (req, res) => {
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    const data = clean(req.body || {});
    data.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const upd = buildUpdate('products', p.id, data);
    guard(() => db.prepare(upd.sql).run(upd.params));
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(p.id));
  });

  r.delete('/products/:id', (req, res) => {
    // Si ya se usó en cotizaciones, solo se desactiva para conservar el historial.
    const used = db.prepare('SELECT 1 FROM quote_items WHERE product_id = ? LIMIT 1').get(req.params.id);
    const info = used
      ? db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id)
      : db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Producto no encontrado');
    res.json({ ok: true, deactivated: Boolean(used) });
  });

  return r;
}
