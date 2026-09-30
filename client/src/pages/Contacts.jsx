import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { LEAD_STATUS, SOURCES, fmtPhone, timeAgo, fmtDateTime, parseDate } from '../format.js';
import Modal from '../components/Modal.jsx';
import ContactForm from '../components/ContactForm.jsx';
import { toast } from '../components/Toast.jsx';

export default function Contacts() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ q: '', type: '', status: '', source: '' });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    api(`/contacts${qs ? '?' + qs : ''}`).then(setRows);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [filters]); // eslint-disable-line
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Leads y clientes</h1>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)}>Importar CSV</button>
          <button className="btn primary" onClick={() => setCreating(true)}>+ Nuevo lead</button>
        </div>
      </div>

      <div className="filters">
        <input placeholder="Buscar nombre, empresa, teléfono, email…" value={filters.q} onChange={set('q')} />
        <select value={filters.type} onChange={set('type')}>
          <option value="">Leads y clientes</option>
          <option value="lead">Solo leads</option>
          <option value="cliente">Solo clientes</option>
        </select>
        <select value={filters.status} onChange={set('status')}>
          <option value="">Todos los estatus</option>
          {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.source} onChange={set('source')}>
          <option value="">Todos los orígenes</option>
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Empresa</th><th>WhatsApp</th><th>Estatus</th><th>Unidades</th><th>Origen</th><th>Asesor</th><th>Próx. seguimiento</th><th>Últ. contacto</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => navigate(`/contactos/${c.id}`)} className="clickable">
                <td>
                  <strong>{c.name}</strong>
                  {c.type === 'cliente' && <span className="pill blue small">Cliente</span>}
                  {c.unread_count > 0 && <span className="pill green small">{c.unread_count} nuevo(s)</span>}
                </td>
                <td>{c.company || '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {c.phone ? <Link to={`/whatsapp/${c.id}`}>💬 {fmtPhone(c.phone)}</Link> : '—'}
                </td>
                <td><span className={`pill status-${c.status}`}>{LEAD_STATUS[c.status]}</span></td>
                <td>{c.fleet_size ?? '—'}</td>
                <td>{c.source || '—'}</td>
                <td>{c.owner_name || '—'}</td>
                <td className={c.next_followup && parseDate(c.next_followup) < new Date() ? 'danger' : ''}>{c.next_followup ? fmtDateTime(c.next_followup) : '—'}</td>
                <td>{timeAgo(c.last_contact_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="muted center">Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal title="Nuevo lead" onClose={() => setCreating(false)} wide>
          <ContactForm onCancel={() => setCreating(false)} onSaved={(c) => { toast('Lead creado'); navigate(`/contactos/${c.id}`); }} />
        </Modal>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase()
    .replace(/nombre/, 'name').replace(/empresa/, 'company').replace(/tel[eé]fono|whatsapp|celular/, 'phone')
    .replace(/correo/, 'email').replace(/origen/, 'source').replace(/ciudad/, 'city').replace(/unidades/, 'fleet_size').replace(/notas/, 'notes'));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i], v])));
}

function ImportModal({ onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);

  async function doImport() {
    try {
      const r = await api('/contacts/import', { method: 'POST', body: rows });
      setResult(r);
      toast(`${r.created} contactos importados`);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  return (
    <Modal title="Importar leads desde CSV" onClose={result ? onDone : onClose}>
      <p className="muted small">Columnas reconocidas: <code>nombre, empresa, telefono, email, origen, ciudad, unidades, notas</code>. Se omiten teléfonos duplicados.</p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files[0]; if (f) setRows(parseCsv(await f.text())); }} />
      {rows.length > 0 && !result && (
        <>
          <p>{rows.length} filas detectadas. Ejemplo: <strong>{rows[0].name}</strong> {rows[0].phone}</p>
          <button className="btn primary" onClick={doImport}>Importar {rows.length} contactos</button>
        </>
      )}
      {result && (
        <div>
          <p>✅ {result.created} creados · {result.skipped.length} omitidos</p>
          <ul className="small">{result.skipped.slice(0, 20).map((s) => <li key={s.row}>Fila {s.row}: {s.reason}</li>)}</ul>
          <button className="btn primary" onClick={onDone}>Listo</button>
        </div>
      )}
    </Modal>
  );
}
