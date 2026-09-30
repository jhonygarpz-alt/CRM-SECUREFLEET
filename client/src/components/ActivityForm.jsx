import { useState } from 'react';
import { api } from '../api.js';
import { ACTIVITY_TYPES, localDateTime } from '../format.js';

export default function ActivityForm({ contactId, dealId, onSaved, onCancel, defaultType = 'whatsapp' }) {
  const [form, setForm] = useState({ type: defaultType, subject: '', notes: '', due_at: localDateTime(1), done: false });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const saved = await api('/activities', {
        method: 'POST',
        body: { ...form, contact_id: contactId, deal_id: dealId || null, due_at: form.done ? null : form.due_at || null },
      });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <label>Tipo
        <select value={form.type} onChange={set('type')}>
          {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Fecha de seguimiento
        <input type="datetime-local" value={form.due_at} onChange={set('due_at')} disabled={form.done} />
      </label>
      <div className="span-2 chips">
        {[['Mañana', 1], ['En 3 días', 3], ['En 1 semana', 7], ['En 15 días', 15]].map(([l, d]) => (
          <button type="button" key={l} className="chip" onClick={() => setForm({ ...form, due_at: localDateTime(d) })}>{l}</button>
        ))}
      </div>
      <label className="span-2">Asunto *<input required value={form.subject} onChange={set('subject')} placeholder="ej. Confirmar demo / enviar cotización" autoFocus /></label>
      <label className="span-2">Notas<textarea rows={3} value={form.notes} onChange={set('notes')} /></label>
      <label className="check span-2"><input type="checkbox" checked={form.done} onChange={set('done')} /> Ya se realizó (registrar en historial)</label>
      {error && <p className="error span-2">{error}</p>}
      <div className="form-actions span-2">
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar</button>
      </div>
    </form>
  );
}
