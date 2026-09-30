import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LEAD_STATUS, STAGE_LABEL, STAGES, QUOTE_STATUS, ACTIVITY_TYPES, money, fmtDate, fmtDateTime, fmtPhone, parseDate } from '../format.js';
import Modal from '../components/Modal.jsx';
import ContactForm from '../components/ContactForm.jsx';
import ActivityForm from '../components/ActivityForm.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import { toast } from '../components/Toast.jsx';

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('whatsapp');
  const [modal, setModal] = useState(null);

  const load = useCallback(() => api(`/contacts/${id}`).then(setC).catch((e) => toast(e.message, 'err')), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <div className="page"><p className="muted">Cargando…</p></div>;

  async function toggleDone(a) {
    await api(`/activities/${a.id}`, { method: 'PUT', body: { done: !a.done } });
    load();
  }
  async function remove() {
    if (!confirm(`¿Eliminar a ${c.name} con todo su historial?`)) return;
    await api(`/contacts/${c.id}`, { method: 'DELETE' });
    navigate('/contactos');
  }
  async function setStatus(status) {
    await api(`/contacts/${c.id}`, { method: 'PUT', body: { status } });
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/contactos" className="muted small">← Leads y clientes</Link>
          <h1>{c.name} {c.type === 'cliente' && <span className="pill blue">Cliente</span>}</h1>
          <div className="muted">{[c.position, c.company, c.city].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="row">
          <select value={c.status} onChange={(e) => setStatus(e.target.value)} className={`status-select status-${c.status}`}>
            {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn" onClick={() => setModal('edit')}>Editar</button>
          <button className="btn danger-outline" onClick={remove}>Eliminar</button>
        </div>
      </div>

      <div className="detail">
        <aside className="card detail-side">
          <dl>
            <dt>WhatsApp</dt><dd>{c.phone ? <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer">{fmtPhone(c.phone)}</a> : '—'}{!c.whatsapp_opt_in && <span className="pill gray small">Sin consentimiento</span>}</dd>
            <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
            <dt>Unidades de flotilla</dt><dd>{c.fleet_size ?? '—'}</dd>
            <dt>Origen</dt><dd>{c.source || '—'}</dd>
            <dt>Asesor</dt><dd>{c.owner_name || '—'}</dd>
            <dt>Etiquetas</dt><dd>{c.tags ? c.tags.split(',').map((t) => <span key={t} className="pill gray small">{t.trim()}</span>) : '—'}</dd>
            <dt>Creado</dt><dd>{fmtDate(c.created_at)}</dd>
            <dt>Último contacto</dt><dd>{fmtDateTime(c.last_contact_at)}</dd>
          </dl>
          {c.notes && <><h4>Notas</h4><p className="pre">{c.notes}</p></>}
          <div className="stack">
            <button className="btn primary block" onClick={() => setModal('activity')}>+ Programar seguimiento</button>
            <button className="btn block" onClick={() => setModal('deal')}>+ Nueva oportunidad</button>
            <Link className="btn block" to={`/cotizaciones/nueva?contact=${c.id}`}>+ Nueva cotización</Link>
          </div>
        </aside>

        <section className="detail-main">
          <div className="tabs">
            {[['whatsapp', '💬 WhatsApp'], ['actividades', `⏰ Seguimientos (${c.activities.filter((a) => !a.done).length})`],
              ['oportunidades', `🧭 Oportunidades (${c.deals.length})`], ['cotizaciones', `🧾 Cotizaciones (${c.quotes.length})`]].map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'whatsapp' && (c.phone
            ? <div className="card no-pad"><ChatPanel contactId={c.id} showHeader={false} onChange={load} /></div>
            : <div className="card"><p className="muted">Agrega un número de WhatsApp al contacto para conversar desde el CRM.</p></div>)}

          {tab === 'actividades' && (
            <div className="card">
              <ul className="timeline">
                {c.activities.map((a) => (
                  <li key={a.id} className={`${a.done ? 'done' : ''} ${!a.done && a.due_at && parseDate(a.due_at) < new Date() ? 'overdue' : ''}`}>
                    <input type="checkbox" checked={Boolean(a.done)} onChange={() => toggleDone(a)} title="Marcar como hecha" />
                    <div>
                      <strong>{ACTIVITY_TYPES[a.type] || a.type} · {a.subject}</strong>
                      {a.notes && <p className="pre small">{a.notes}</p>}
                      <small className="muted">
                        {a.due_at && !a.done ? `Programada: ${fmtDateTime(a.due_at)}` : `Registrada: ${fmtDateTime(a.done_at || a.created_at)}`}
                        {a.user_name ? ` · ${a.user_name}` : ''}
                      </small>
                    </div>
                  </li>
                ))}
                {c.activities.length === 0 && <p className="muted">Sin actividades.</p>}
              </ul>
            </div>
          )}

          {tab === 'oportunidades' && (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Oportunidad</th><th>Etapa</th><th>Valor</th><th>Unidades</th><th>Cierre estimado</th></tr></thead>
                <tbody>
                  {c.deals.map((d) => (
                    <tr key={d.id}>
                      <td>{d.title}</td>
                      <td>
                        <select value={d.stage} onChange={async (e) => { await api(`/deals/${d.id}`, { method: 'PUT', body: { stage: e.target.value } }); load(); }}>
                          {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td>{money(d.value, d.currency)}</td>
                      <td>{d.units ?? '—'}</td>
                      <td>{fmtDate(d.expected_close)}</td>
                    </tr>
                  ))}
                  {c.deals.length === 0 && <tr><td colSpan={5} className="muted">Sin oportunidades.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'cotizaciones' && (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Folio</th><th>Fecha</th><th>Vigencia</th><th>Estatus</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {c.quotes.map((q) => (
                    <tr key={q.id} className="clickable" onClick={() => navigate(`/cotizaciones/${q.id}`)}>
                      <td>{q.folio}</td><td>{fmtDate(q.issue_date)}</td><td>{fmtDate(q.valid_until)}</td>
                      <td><span className={`pill q-${q.status}`}>{QUOTE_STATUS[q.status]}</span></td>
                      <td className="num">{money(q.total, q.currency)}</td>
                    </tr>
                  ))}
                  {c.quotes.length === 0 && <tr><td colSpan={5} className="muted">Sin cotizaciones.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {modal === 'edit' && (
        <Modal title="Editar contacto" onClose={() => setModal(null)} wide>
          <ContactForm initial={c} onCancel={() => setModal(null)} onSaved={() => { setModal(null); load(); toast('Guardado'); }} />
        </Modal>
      )}
      {modal === 'activity' && (
        <Modal title="Programar seguimiento" onClose={() => setModal(null)}>
          <ActivityForm contactId={c.id} onCancel={() => setModal(null)} onSaved={() => { setModal(null); setTab('actividades'); load(); }} />
        </Modal>
      )}
      {modal === 'deal' && (
        <Modal title="Nueva oportunidad" onClose={() => setModal(null)}>
          <DealForm contact={c} onCancel={() => setModal(null)} onSaved={() => { setModal(null); setTab('oportunidades'); load(); }} />
        </Modal>
      )}
    </div>
  );
}

export function DealForm({ contact, deal, onSaved, onCancel }) {
  const [f, setF] = useState(deal || { title: contact ? `${contact.company || contact.name} - GPS` : '', stage: 'prospecto', value: '', units: contact?.fleet_size || '', expected_close: '', notes: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    try {
      const body = { title: f.title, stage: f.stage, value: Number(f.value) || 0, units: f.units ? Number(f.units) : null, expected_close: f.expected_close || null, notes: f.notes, lost_reason: f.lost_reason };
      const saved = deal
        ? await api(`/deals/${deal.id}`, { method: 'PUT', body })
        : await api('/deals', { method: 'POST', body: { ...body, contact_id: contact.id } });
      onSaved(saved);
    } catch (err) { setError(err.message); }
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="span-2">Nombre de la oportunidad *<input required value={f.title} onChange={set('title')} autoFocus /></label>
      <label>Etapa<select value={f.stage} onChange={set('stage')}>{STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Valor estimado (MXN)<input type="number" min="0" step="0.01" value={f.value} onChange={set('value')} /></label>
      <label>Unidades<input type="number" min="0" value={f.units ?? ''} onChange={set('units')} /></label>
      <label>Cierre estimado<input type="date" value={f.expected_close || ''} onChange={set('expected_close')} /></label>
      {f.stage === 'perdido' && <label className="span-2">Motivo de pérdida<input value={f.lost_reason || ''} onChange={set('lost_reason')} /></label>}
      <label className="span-2">Notas<textarea rows={3} value={f.notes || ''} onChange={set('notes')} /></label>
      {error && <p className="error span-2">{error}</p>}
      <div className="form-actions span-2">
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn primary">Guardar</button>
      </div>
    </form>
  );
}
