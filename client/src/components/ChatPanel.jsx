import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtTime, fmtDate, parseDate, fmtPhone, LEAD_STATUS } from '../format.js';
import { toast } from './Toast.jsx';

const STATUS_ICON = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠', simulated: '⧗', received: '' };

export default function ChatPanel({ contactId, showHeader = true, onChange }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replies, setReplies] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [showTpl, setShowTpl] = useState(false);
  const [tpl, setTpl] = useState({ name: '', params: '' });
  const [waStatus, setWaStatus] = useState(null);
  const endRef = useRef(null);
  const lastCount = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const notify = () => onChangeRef.current?.();

  const load = useCallback(async () => {
    const d = await api(`/whatsapp/conversations/${contactId}`);
    setData(d);
    if (d.messages.length !== lastCount.current) {
      lastCount.current = d.messages.length;
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      if (d.messages.some((m) => m.direction === 'in')) {
        api(`/whatsapp/conversations/${contactId}/read`, { method: 'POST' }).then(notify).catch(() => {});
      }
    }
  }, [contactId]);

  useEffect(() => {
    lastCount.current = 0;
    setData(null);
    load().catch((e) => toast(e.message, 'err'));
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    api('/whatsapp/quick-replies').then(setReplies).catch(() => {});
    api('/whatsapp/templates').then(setTemplates).catch(() => {});
    api('/whatsapp/status').then(setWaStatus).catch(() => {});
  }, []);

  async function send(e) {
    e?.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api(`/whatsapp/conversations/${contactId}/send`, { method: 'POST', body: { body: text } });
      setText('');
      await load();
      notify();
    } catch (err) {
      toast(err.message, 'err');
      if (err.message.includes('plantilla')) setShowTpl(true);
    } finally {
      setSending(false);
    }
  }

  async function sendTemplate(e) {
    e.preventDefault();
    const params = tpl.params.split('|').map((s) => s.trim()).filter(Boolean);
    const t = templates.find((x) => x.name === tpl.name);
    let preview = '';
    const bodyComp = t?.components?.find((c) => c.type === 'BODY');
    if (bodyComp?.text) preview = bodyComp.text.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? `{{${i}}}`);
    try {
      await api(`/whatsapp/conversations/${contactId}/template`, {
        method: 'POST', body: { name: tpl.name, language: t?.language, params, preview: preview || undefined },
      });
      toast('Plantilla enviada');
      setShowTpl(false);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  if (!data) return <div className="chat"><div className="muted pad">Cargando conversación…</div></div>;
  const { contact, messages } = data;
  const suggestions = text.startsWith('/') ? replies.filter((r) => r.shortcut.startsWith(text.split(' ')[0])) : [];
  const liveMode = waStatus?.configured;
  const noWindowRule = waStatus?.requiresWindow === false; // modo WhatsApp Web: sin regla de 24 h
  const canFreeText = !liveMode || contact.window_open || noWindowRule;

  let lastDay = '';
  return (
    <div className="chat">
      {showHeader && (
        <div className="chat-head">
          <div className="avatar">{contact.name[0]}</div>
          <div>
            <Link to={`/contactos/${contact.id}`}><strong>{contact.name}</strong></Link>
            <small>{contact.company ? `${contact.company} · ` : ''}{fmtPhone(contact.phone)} · {LEAD_STATUS[contact.status]}</small>
          </div>
          {!noWindowRule && <span className={`pill ${contact.window_open ? 'green' : 'gray'}`} title="WhatsApp permite mensajes libres solo 24 h después del último mensaje del cliente">
            {contact.window_open ? 'Ventana 24 h abierta' : 'Ventana cerrada'}
          </span>}
        </div>
      )}
      {waStatus && !waStatus.configured && (
        <div className="banner warn">Modo simulación: los mensajes se registran pero no se envían. Configura la API de WhatsApp en el servidor.</div>
      )}
      <div className="chat-body">
        {messages.length === 0 && <div className="muted pad center">Sin mensajes todavía.</div>}
        {messages.map((m) => {
          const day = fmtDate(m.created_at);
          const sep = day !== lastDay ? (lastDay = day) : null;
          return (
            <div key={m.id}>
              {sep && <div className="day-sep"><span>{sep}</span></div>}
              <div className={`bubble ${m.direction === 'in' ? 'in' : 'out'} ${m.status === 'failed' ? 'failed' : ''}`}>
                {m.type === 'document' && <div className="doc">📄 {m.filename}</div>}
                {m.type === 'template' && <div className="tpl-tag">Plantilla</div>}
                <div className="bubble-text">{m.body}</div>
                <div className="bubble-meta">
                  {m.direction === 'out' && m.user_name ? `${m.user_name} · ` : ''}
                  {fmtTime(m.created_at)}
                  {m.direction === 'out' && (
                    <span className={`tick ${m.status}`} title={m.error || m.status}> {STATUS_ICON[m.status] ?? ''}</span>
                  )}
                </div>
                {m.error && <div className="error small">{m.error}</div>}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {showTpl || !canFreeText ? (
        <form className="tpl-form" onSubmit={sendTemplate}>
          <div className="muted small">
            {canFreeText ? 'Enviar plantilla aprobada' : 'Han pasado más de 24 h desde el último mensaje del cliente: WhatsApp exige una plantilla aprobada para retomar la conversación.'}
          </div>
          <div className="row">
            {templates.length ? (
              <select required value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })}>
                <option value="">Selecciona plantilla…</option>
                {templates.map((t) => <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>)}
              </select>
            ) : (
              <input required placeholder="Nombre de la plantilla" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
            )}
            <input placeholder="Variables separadas por |  (ej. Juan | SF-COT-2026-0001)" value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} />
            <button className="btn primary">Enviar plantilla</button>
            {canFreeText && <button type="button" className="btn" onClick={() => setShowTpl(false)}>Cancelar</button>}
          </div>
        </form>
      ) : (
        <form className="composer" onSubmit={send}>
          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((r) => (
                <button type="button" key={r.id} onClick={() => setText(r.body)}><strong>{r.shortcut}</strong> {r.body}</button>
              ))}
            </div>
          )}
          {!noWindowRule && <button type="button" className="btn-icon" title="Enviar plantilla" onClick={() => setShowTpl(true)}>📋</button>}
          <textarea
            rows={1}
            value={text}
            placeholder="Escribe un mensaje…  (usa / para respuestas rápidas)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          />
          <button className="btn primary" disabled={sending || !text.trim()}>Enviar</button>
        </form>
      )}
      {contact.last_inbound_at && (
        <div className="muted small pad-x">Último mensaje del cliente: {parseDate(contact.last_inbound_at).toLocaleString('es-MX')}</div>
      )}
    </div>
  );
}
