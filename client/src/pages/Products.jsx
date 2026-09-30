import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, BILLING } from '../format.js';
import Modal from '../components/Modal.jsx';
import { toast } from '../components/Toast.jsx';

const EMPTY = { sku: '', name: '', description: '', type: 'producto', category: '', unit: 'pieza', price: '', cost: '', billing: 'unico', tax_rate: 0.16, active: true };

export default function Products() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => api(`/products?${new URLSearchParams({ q, type })}`).then(setRows);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, type]); // eslint-disable-line

  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Catálogo de productos y servicios</h1>
        <button className="btn primary" onClick={() => setEditing(EMPTY)}>+ Nuevo</button>
      </div>
      <div className="filters">
        <input placeholder="Buscar por nombre o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Productos y servicios</option>
          <option value="producto">Productos</option>
          <option value="servicio">Servicios</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>Nombre</th><th>Tipo</th><th>Categoría</th><th>Cobro</th><th className="num">Precio</th><th className="num">Margen</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={`clickable ${p.active ? '' : 'inactive'}`} onClick={() => setEditing({ ...p, active: Boolean(p.active) })}>
                <td><code>{p.sku || '—'}</code></td>
                <td><strong>{p.name}</strong><div className="muted small clamp">{p.description}</div></td>
                <td>{p.type === 'producto' ? '📦 Producto' : '🛠️ Servicio'}</td>
                <td>{p.category || '—'}</td>
                <td>{BILLING[p.billing]}</td>
                <td className="num">{money(p.price, p.currency)}<small className="muted"> / {p.unit}</small></td>
                <td className="num">{p.cost ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : '—'}</td>
                <td>{!p.active && <span className="pill gray small">Inactivo</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted center">Sin productos. Ejecuta <code>npm run seed</code> en el servidor para cargar el catálogo base.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing.id ? 'Editar producto' : 'Nuevo producto o servicio'} onClose={() => setEditing(null)} wide>
          <ProductForm initial={editing} categories={categories} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast('Guardado'); }} />
        </Modal>
      )}
    </div>
  );
}

function ProductForm({ initial, categories, onSaved, onCancel }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const body = { sku: f.sku, name: f.name, description: f.description, type: f.type, category: f.category, unit: f.unit,
        price: Number(f.price) || 0, cost: f.cost === '' || f.cost == null ? null : Number(f.cost), billing: f.billing,
        tax_rate: Number(f.tax_rate), active: f.active };
      await (f.id ? api(`/products/${f.id}`, { method: 'PUT', body }) : api('/products', { method: 'POST', body }));
      onSaved();
    } catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!confirm('¿Eliminar este producto? Si ya se usó en cotizaciones solo se desactivará.')) return;
    const r = await api(`/products/${f.id}`, { method: 'DELETE' });
    toast(r.deactivated ? 'Producto desactivado (tiene cotizaciones)' : 'Producto eliminado');
    onSaved();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>Nombre *<input required value={f.name} onChange={set('name')} autoFocus /></label>
      <label>SKU / Clave<input value={f.sku || ''} onChange={set('sku')} /></label>
      <label className="span-2">Descripción (aparece en la cotización)<textarea rows={2} value={f.description || ''} onChange={set('description')} /></label>
      <label>Tipo<select value={f.type} onChange={set('type')}><option value="producto">Producto</option><option value="servicio">Servicio</option></select></label>
      <label>Categoría<input list="cats" value={f.category || ''} onChange={set('category')} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
      <label>Precio de venta (sin IVA) *<input required type="number" min="0" step="0.01" value={f.price} onChange={set('price')} /></label>
      <label>Costo (opcional)<input type="number" min="0" step="0.01" value={f.cost ?? ''} onChange={set('cost')} /></label>
      <label>Unidad<input value={f.unit} onChange={set('unit')} placeholder="pieza, servicio, unidad/mes…" /></label>
      <label>Cobro<select value={f.billing} onChange={set('billing')}>{Object.entries(BILLING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>IVA<select value={f.tax_rate} onChange={set('tax_rate')}><option value={0.16}>16%</option><option value={0.08}>8% (frontera)</option><option value={0}>0% / Exento</option></select></label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Activo (disponible para cotizar)</label>
      {error && <p className="error span-2">{error}</p>}
      <div className="form-actions span-2">
        {f.id && <button type="button" className="btn danger-outline" onClick={remove}>Eliminar</button>}
        <span className="grow" />
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar</button>
      </div>
    </form>
  );
}
