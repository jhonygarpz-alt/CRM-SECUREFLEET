import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, STAGE_LABEL, fmtDateTime, timeAgo, ACTIVITY_TYPES, parseDate } from '../format.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(false);

  useEffect(() => { api(`/dashboard${mine ? '?mine=1' : ''}`).then(setData); }, [mine]);
  if (!data) return <div className="page"><p className="muted">Cargando…</p></div>;
  const { kpis, pipeline, sources, upcoming, stale, monthly } = data;
  const maxStage = Math.max(1, ...pipeline.map((p) => p.value));
  const maxSource = Math.max(1, ...sources.map((s) => s.count));
  const maxMonth = Math.max(1, ...monthly.map((m) => m.value));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tablero</h1>
        <div className="seg">
          <button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Todo el equipo</button>
          <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Solo míos</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Pipeline abierto" value={money(kpis.pipeline_abierto)} sub={`Ponderado: ${money(kpis.pipeline_ponderado)}`} />
        <Kpi label="Ganado este mes" value={money(kpis.ganado_mes)} sub={kpis.tasa_cierre != null ? `Tasa de cierre ${kpis.tasa_cierre}%` : 'Sin cierres aún'} />
        <Kpi label="Leads nuevos (mes)" value={kpis.leads_nuevos_mes} sub={`${kpis.leads_activos} leads activos · ${kpis.clientes} clientes`} to="/contactos" />
        <Kpi label="WhatsApp sin leer" value={kpis.whatsapp_sin_leer} sub="Mensajes de clientes" to="/whatsapp" alert={kpis.whatsapp_sin_leer > 0} />
        <Kpi label="Seguimientos vencidos" value={kpis.seguimientos_vencidos} sub="Tareas atrasadas" to="/seguimientos" alert={kpis.seguimientos_vencidos > 0} />
        <Kpi label="Cotizaciones abiertas" value={kpis.cotizaciones_abiertas} sub="Borrador o enviadas" to="/cotizaciones" />
      </div>

      <div className="grid-2">
        <section className="card">
          <h3>Embudo de ventas</h3>
          {pipeline.map((p) => (
            <div className="bar-row" key={p.stage}>
              <span className="bar-label">{STAGE_LABEL[p.stage]}</span>
              <div className="bar-track"><div className={`bar-fill stage-${p.stage}`} style={{ width: `${(p.value / maxStage) * 100}%` }} /></div>
              <span className="bar-value">{p.count} · {money(p.value)}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>Próximos seguimientos</h3>
          {upcoming.length === 0 && <p className="muted">Sin seguimientos programados.</p>}
          <ul className="list">
            {upcoming.map((a) => (
              <li key={a.id} className={parseDate(a.due_at) < new Date() ? 'overdue' : ''}>
                <span>{ACTIVITY_TYPES[a.type]?.split(' ')[0]}</span>
                <div>
                  <Link to={`/contactos/${a.contact_id}`}>{a.subject}</Link>
                  <small>{a.contact_name}{a.contact_company ? ` · ${a.contact_company}` : ''}</small>
                </div>
                <small>{fmtDateTime(a.due_at)}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Leads sin contacto (+3 días)</h3>
          {stale.length === 0 && <p className="muted">¡Todo al día! 🎉</p>}
          <ul className="list">
            {stale.map((c) => (
              <li key={c.id}>
                <span>⚠️</span>
                <div>
                  <Link to={`/contactos/${c.id}`}>{c.name}</Link>
                  <small>{c.company || '—'} · último contacto {timeAgo(c.last_contact_at || c.created_at)}</small>
                </div>
                {c.phone && <Link className="btn small wa" to={`/whatsapp/${c.id}`}>💬 Escribir</Link>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Origen de leads</h3>
          {sources.map((s) => (
            <div className="bar-row" key={s.source}>
              <span className="bar-label">{s.source}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / maxSource) * 100}%` }} /></div>
              <span className="bar-value">{s.count}</span>
            </div>
          ))}
          {monthly.length > 0 && (
            <>
              <h3 className="mt">Ventas ganadas por mes</h3>
              {monthly.map((m) => (
                <div className="bar-row" key={m.month}>
                  <span className="bar-label">{m.month}</span>
                  <div className="bar-track"><div className="bar-fill stage-ganado" style={{ width: `${(m.value / maxMonth) * 100}%` }} /></div>
                  <span className="bar-value">{money(m.value)}</span>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, to, alert }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small>{sub}</small>
    </>
  );
  return to ? <Link to={to} className={`card kpi ${alert ? 'alert' : ''}`}>{body}</Link> : <div className="card kpi">{body}</div>;
}
