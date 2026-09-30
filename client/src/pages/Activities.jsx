import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ACTIVITY_TYPES, fmtDateTime, parseDate, localDateTime } from '../format.js';
import { useAuth } from '../App.jsx';

const FILTERS = [['vencidas', 'Vencidos'], ['hoy', 'Hoy'], ['pendientes', 'Pendientes'], ['completadas', 'Completados']];

export default function Activities() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('pendientes');
  const [mine, setMine] = useState(true);
  const [rows, setRows] = useState([]);

  const load = () => api(`/activities?${new URLSearchParams({ filter, ...(mine ? { user_id: user.id } : {}) })}`).then(setRows);
  useEffect(() => { load(); }, [filter, mine]); // eslint-disable-line

  async function done(a) {
    await api(`/activities/${a.id}`, { method: 'PUT', body: { done: !a.done } });
    load();
  }
  async function postpone(a, days) {
    await api(`/activities/${a.id}`, { method: 'PUT', body: { due_at: localDateTime(days) } });
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Seguimientos</h1>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Solo los míos</label>
      </div>
      <div className="seg mb">
        {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="card">
        <ul className="timeline">
          {rows.map((a) => {
            const overdue = !a.done && a.due_at && parseDate(a.due_at) < new Date();
            return (
              <li key={a.id} className={`${a.done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
                <input type="checkbox" checked={Boolean(a.done)} onChange={() => done(a)} />
                <div className="grow">
                  <strong>{ACTIVITY_TYPES[a.type] || a.type} · {a.subject}</strong>
                  <div className="small">
                    {a.contact_id && <Link to={`/contactos/${a.contact_id}`}>{a.contact_name}{a.contact_company ? ` (${a.contact_company})` : ''}</Link>}
                    {a.notes && <span className="muted"> — {a.notes}</span>}
                  </div>
                  <small className={overdue ? 'danger' : 'muted'}>{a.due_at ? fmtDateTime(a.due_at) : 'Sin fecha'}{a.user_name ? ` · ${a.user_name}` : ''}</small>
                </div>
                {!a.done && (
                  <div className="row">
                    {a.contact_phone && <Link className="btn small wa" to={`/whatsapp/${a.contact_id}`}>💬</Link>}
                    <button className="btn small" onClick={() => postpone(a, 1)}>+1 día</button>
                    <button className="btn small" onClick={() => postpone(a, 7)}>+1 sem</button>
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 && <p className="muted">Nada por aquí 👌</p>}
        </ul>
      </div>
    </div>
  );
}
