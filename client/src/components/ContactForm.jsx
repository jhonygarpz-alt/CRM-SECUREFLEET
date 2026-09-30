import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { LEAD_STATUS, SOURCES } from '../format.js';

const EMPTY = { name: '', company: '', position: '', phone: '', email: '', source: '', status: 'nuevo', fleet_size: '', city: '', tags: '', notes: '', owner_id: '', whatsapp_opt_in: true };

export default function ContactForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}), whatsapp_opt_in: initial ? Boolean(initial.whatsapp_opt_in) : true });
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form, fleet_size: form.fleet_size === '' ? null : Number(form.fleet_size), owner_id: form.owner_id || null };
      for (const k of ['id', 'deals', 'quotes', 'activities', 'owner_name', 'created_at', 'updated_at', 'last_contact_at', 'last_inbound_at', 'unread_count', 'type']) delete body[k];
      const saved = initial?.id
        ? await api(`/contacts/${initial.id}`, { method: 'PUT', body })
        : await api('/contacts', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <label>Nombre *<input required value={form.name} onChange={set('name')} autoFocus /></label>
      <label>Empresa<input value={form.company || ''} onChange={set('company')} /></label>
      <label>WhatsApp / Teléfono<input value={form.phone || ''} onChange={set('phone')} placeholder="10 dígitos o con lada +52" /></label>
      <label>Email<input type="email" value={form.email || ''} onChange={set('email')} /></label>
      <label>Puesto<input value={form.position || ''} onChange={set('position')} /></label>
      <label>Ciudad<input value={form.city || ''} onChange={set('city')} /></label>
      <label>Tamaño de flotilla (unidades)<input type="number" min="0" value={form.fleet_size ?? ''} onChange={set('fleet_size')} /></label>
      <label>Origen
        <select value={form.source || ''} onChange={set('source')}>
          <option value="">—</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label>Estatus
        <select value={form.status} onChange={set('status')}>
          {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Asesor asignado
        <select value={form.owner_id || ''} onChange={set('owner_id')}>
          <option value="">Yo</option>
          {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label className="span-2">Etiquetas<input value={form.tags || ''} onChange={set('tags')} placeholder="ej. transporte, carga pesada" /></label>
      <label className="span-2">Notas<textarea rows={3} value={form.notes || ''} onChange={set('notes')} /></label>
      <label className="check span-2"><input type="checkbox" checked={form.whatsapp_opt_in} onChange={set('whatsapp_opt_in')} /> Acepta recibir mensajes por WhatsApp</label>
      {error && <p className="error span-2">{error}</p>}
      <div className="form-actions span-2">
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}
