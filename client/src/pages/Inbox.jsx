import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { timeAgo, fmtPhone } from '../format.js';
import ChatPanel from '../components/ChatPanel.jsx';
import Modal from '../components/Modal.jsx';
import { toast } from '../components/Toast.jsx';

export default function Inbox() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const [convs, setConvs] = useState([]);
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(() => {
    api(`/whatsapp/conversations?${new URLSearchParams({ q, unread: unreadOnly ? '1' : '' })}`).then(setConvs).catch(() => {});
  }, [q, unreadOnly]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { api('/whatsapp/status').then(setStatus); }, []);

  return (
    <div className="page inbox-page">
      <div className="inbox">
        <aside className={`inbox-list ${contactId ? 'hide-mobile' : ''}`}>
          <div className="inbox-tools">
            <div className="row between">
              <h2>WhatsApp</h2>
              <div className="row">
                {status && !status.configured && <button className="btn small" onClick={() => setSimulate(true)} title="Simular mensaje entrante">🧪</button>}
                <button className="btn small primary" onClick={() => setNewChat(true)}>+ Chat</button>
              </div>
            </div>
            <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check small"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Solo no leídos</label>
          </div>
          <ul>
            {convs.map((c) => (
              <li key={c.id} className={`${String(c.id) === contactId ? 'active' : ''} ${c.unread_count ? 'unread' : ''}`} onClick={() => navigate(`/whatsapp/${c.id}`)}>
                <div className="avatar">{c.name[0]}</div>
                <div className="grow ellipsis">
                  <div className="row between">
                    <strong className="ellipsis">{c.name}</strong>
                    <small className="muted">{timeAgo(c.last_at)}</small>
                  </div>
                  <div className="row between">
                    <small className="ellipsis muted">{c.last_direction === 'out' ? '↪ ' : ''}{c.last_body}</small>
                    {c.unread_count > 0 && <span className="badge-count">{c.unread_count}</span>}
                  </div>
                  {c.company && <small className="muted">{c.company}</small>}
                </div>
              </li>
            ))}
            {convs.length === 0 && <li className="muted pad">No hay conversaciones todavía. Cuando un cliente escriba a tu WhatsApp Business aparecerá aquí.</li>}
          </ul>
        </aside>
        <section className={`inbox-chat ${contactId ? '' : 'hide-mobile'}`}>
          {contactId ? (
            <>
              <button className="btn-link show-mobile" onClick={() => navigate('/whatsapp')}>← Conversaciones</button>
              <ChatPanel key={contactId} contactId={contactId} onChange={load} />
            </>
          ) : (
            <div className="empty-chat"><div>💬</div><p>Selecciona una conversación</p></div>
          )}
        </section>
      </div>
      {newChat && <NewChatModal onClose={() => setNewChat(false)} onPick={(id) => { setNewChat(false); navigate(`/whatsapp/${id}`); }} />}
      {simulate && <SimulateModal onClose={() => setSimulate(false)} onDone={() => { setSimulate(false); load(); }} />}
    </div>
  );
}

function NewChatModal({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => api(`/contacts?q=${encodeURIComponent(q)}`).then((r) => setRows(r.filter((c) => c.phone))), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Iniciar conversación" onClose={onClose}>
      <input autoFocus placeholder="Buscar contacto…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">
        {rows.slice(0, 30).map((c) => (
          <li key={c.id} onClick={() => onPick(c.id)}><strong>{c.name}</strong> <span className="muted">{c.company} · {fmtPhone(c.phone)}</span></li>
        ))}
      </ul>
      <p className="muted small">Para iniciar una conversación con alguien que no te ha escrito en 24 h, WhatsApp requiere una plantilla aprobada.</p>
    </Modal>
  );
}

function SimulateModal({ onClose, onDone }) {
  const [f, setF] = useState({ phone: '5215598765432', name: 'Cliente de prueba', body: 'Hola, me interesa rastreo GPS para 10 camionetas' });
  async function submit(e) {
    e.preventDefault();
    try {
      await api('/whatsapp/simulate-incoming', { method: 'POST', body: f });
      toast('Mensaje entrante simulado');
      onDone();
    } catch (err) { toast(err.message, 'err'); }
  }
  return (
    <Modal title="Simular mensaje entrante" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label>Teléfono<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Nombre de perfil<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="span-2">Mensaje<textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="form-actions span-2"><button className="btn primary">Simular</button></div>
      </form>
    </Modal>
  );
}
