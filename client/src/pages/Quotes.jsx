import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, openQuotePdf } from '../api.js';
import { money, fmtDate, QUOTE_STATUS } from '../format.js';

export default function Quotes() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => api(`/quotes?${new URLSearchParams({ q, status })}`).then(setRows), 200);
    return () => clearTimeout(t);
  }, [q, status]);

  const total = rows.reduce((a, r) => a + r.total, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cotizaciones</h1>
        <Link className="btn primary" to="/cotizaciones/nueva">+ Nueva cotización</Link>
      </div>
      <div className="filters">
        <input placeholder="Buscar folio o cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estatus</option>
          {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="muted">{rows.length} cotizaciones · {money(total)}</span>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Folio</th><th>Cliente</th><th>Fecha</th><th>Vigencia</th><th>Estatus</th><th>Asesor</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/cotizaciones/${r.id}`)}>
                <td><strong>{r.folio}</strong></td>
                <td>{r.contact_company || r.contact_name}<div className="muted small">{r.contact_company ? r.contact_name : ''}</div></td>
                <td>{fmtDate(r.issue_date)}</td>
                <td>{fmtDate(r.valid_until)}</td>
                <td><span className={`pill q-${r.status}`}>{QUOTE_STATUS[r.status]}</span>{r.sent_at && <div className="muted small">💬 enviada</div>}</td>
                <td>{r.created_by_name}</td>
                <td className="num">{money(r.total, r.currency)}</td>
                <td onClick={(e) => e.stopPropagation()}><button className="btn small" onClick={() => openQuotePdf(r.id)}>PDF</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted center">Sin cotizaciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
