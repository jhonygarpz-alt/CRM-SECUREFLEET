import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { STAGES, money, fmtDate } from '../format.js';
import Modal from '../components/Modal.jsx';
import { DealForm } from './ContactDetail.jsx';
import { toast } from '../components/Toast.jsx';

export default function Pipeline() {
  const [deals, setDeals] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showClosed, setShowClosed] = useState(true);

  const load = () => api('/deals').then(setDeals);
  useEffect(() => { load(); }, []);

  async function move(id, stage) {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    let lost_reason;
    if (stage === 'perdido') {
      lost_reason = prompt('¿Motivo por el que se perdió?') ?? undefined;
    }
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage } : d)));
    try {
      await api(`/deals/${id}`, { method: 'PUT', body: { stage, ...(lost_reason ? { lost_reason } : {}) } });
      if (stage === 'ganado') toast('🎉 ¡Venta ganada! El contacto ahora es cliente.');
      load();
    } catch (e) {
      toast(e.message, 'err');
      load();
    }
  }

  const stages = showClosed ? STAGES : STAGES.filter(([k]) => !['ganado', 'perdido'].includes(k));

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Pipeline de ventas</h1>
        <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Mostrar ganadas/perdidas</label>
      </div>
      <p className="muted small">Arrastra las tarjetas entre columnas para actualizar la etapa. Para crear una oportunidad entra a la ficha del lead.</p>
      <div className="kanban">
        {stages.map(([stage, label]) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = items.reduce((a, d) => a + d.value, 0);
          return (
            <div key={stage} className={`kcol ${over === stage ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver(null)}
              onDrop={() => { setOver(null); move(dragId, stage); }}>
              <div className={`khead stage-${stage}`}>
                <strong>{label}</strong>
                <small>{items.length} · {money(total)}</small>
              </div>
              {items.map((d) => (
                <div key={d.id} className="kcard" draggable onDragStart={() => setDragId(d.id)} onClick={() => setEditing(d)}>
                  <strong>{d.title}</strong>
                  <Link to={`/contactos/${d.contact_id}`} onClick={(e) => e.stopPropagation()}>{d.contact_company || d.contact_name}</Link>
                  <div className="kmeta">
                    <span>{money(d.value, d.currency)}</span>
                    {d.units ? <span>{d.units} u.</span> : null}
                    {d.expected_close && <span>📅 {fmtDate(d.expected_close)}</span>}
                  </div>
                  <div className="kfoot">
                    <small>{d.owner_name}</small>
                    {d.contact_phone && <Link to={`/whatsapp/${d.contact_id}`} onClick={(e) => e.stopPropagation()} title="Abrir WhatsApp">💬</Link>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {editing && (
        <Modal title="Editar oportunidad" onClose={() => setEditing(null)}>
          <DealForm deal={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
          <button className="btn danger-outline mt" onClick={async () => {
            if (!confirm('¿Eliminar oportunidad?')) return;
            await api(`/deals/${editing.id}`, { method: 'DELETE' }); setEditing(null); load();
          }}>Eliminar oportunidad</button>
        </Modal>
      )}
    </div>
  );
}
