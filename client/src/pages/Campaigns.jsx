import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDateTime, fmtPhone, LEAD_STATUS } from '../format.js';
import { toast } from '../components/Toast.jsx';

const STATUS_LABEL = { borrador: 'Borrador', enviando: 'Enviando', pausada: 'Pausada', terminada: 'Terminada', cancelada: 'Cancelada' };
const R_LABEL = { pendiente: 'Pendiente', enviado: 'Enviado', omitido: 'Omitido', fallido: 'Falló' };

function useBlobUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    let alive = true;
    let u = null;
    api(path, { raw: true }).then((r) => r.blob()).then((b) => { if (alive) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return url;
}

function Progress({ counts }) {
  const total = Object.values(counts || {}).reduce((a, n) => a + n, 0) || 1;
  const pct = (k) => `${((counts?.[k] || 0) / total) * 100}%`;
  return (
    <div>
      <div className="camp-bar">
        <span style={{ width: pct('enviado'), background: '#1fa855' }} />
        <span style={{ width: pct('omitido'), background: '#f0a92e' }} />
        <span style={{ width: pct('fallido'), background: '#d23b3b' }} />
      </div>
      <small className="muted">
        {counts?.enviado || 0} enviados · {counts?.pendiente || 0} pendientes
        {counts?.omitido ? ` · ${counts.omitido} omitidos` : ''}{counts?.fallido ? ` · ${counts.fallido} fallidos` : ''}
      </small>
    </div>
  );
}

export function CampaignList() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => api('/campaigns').then(setData).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Campañas de WhatsApp</h1>
        <Link className="btn primary" to="/campanas/nueva">+ Nueva campaña</Link>
      </div>
      <div className="banner warn">
        Las campañas se envían <strong>una por una con pausas</strong> y con <strong>límite diario</strong> para cuidar tu número.
        Personaliza el texto con <code>{'{nombre}'}</code> y <code>{'{empresa}'}</code> para que cada mensaje sea distinto.
        {data && <> Enviados hoy: <strong>{data.sentToday}</strong>.</>}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Campaña</th><th>Estatus</th><th style={{ width: 320 }}>Avance</th><th>Creada</th></tr></thead>
          <tbody>
            {(data?.campaigns || []).map((c) => (
              <tr key={c.id}>
                <td><Link to={`/campanas/${c.id}`}><strong>{c.name}</strong></Link><div className="muted small clamp">{c.body}</div></td>
                <td><span className={`pill camp-${c.status}`}>{STATUS_LABEL[c.status]}</span></td>
                <td><Progress counts={c.counts} /></td>
                <td className="small">{fmtDateTime(c.created_at)}<div className="muted">{c.created_by_name}</div></td>
              </tr>
            ))}
            {data && !data.campaigns.length && <tr><td colSpan={4} className="muted center">Aún no hay campañas. En el chat puedes usar "Reenviar a varios" en cualquier mensaje tuyo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Reduce la imagen (máx. 1600 px) y la convierte a JPG para que pese poco. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

export function CampaignNew() {
  const [search] = useSearchParams();
  const fromId = search.get('from');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState(null); // data URL subida
  const [useFromImage, setUseFromImage] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [minDelay, setMinDelay] = useState(45);
  const [maxDelay, setMaxDelay] = useState(120);
  const [dailyLimit, setDailyLimit] = useState(30);
  const [saving, setSaving] = useState(false);
  const fromImageUrl = useBlobUrl(fromId && useFromImage ? `/whatsapp/media/${fromId}` : null);

  useEffect(() => {
    if (!fromId) return;
    api(`/whatsapp/messages/${fromId}`).then((m) => {
      setBody(String(m.body || '').replace(/^\[(imagen|video|documento)\]\s*/i, ''));
      setUseFromImage(Boolean(m.media_path && String(m.media_mime).startsWith('image/')));
      setName(`Reenvío ${new Date().toLocaleDateString('es-MX')}`);
    }).catch(() => {});
  }, [fromId]);

  useEffect(() => {
    const t = setTimeout(() => {
      api(`/contacts?${new URLSearchParams({ q, status: statusF })}`).then((rows) => setContacts(rows.filter((c) => c.phone && c.whatsapp_opt_in)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, statusF]);

  const allVisibleSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const toggleAll = () => {
    const next = new Set(selected);
    contacts.forEach((c) => (allVisibleSelected ? next.delete(c.id) : next.add(c.id)));
    setSelected(next);
  };
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const firstSel = useMemo(() => contacts.find((c) => selected.has(c.id)) || contacts[0], [contacts, selected]);
  const preview = firstSel
    ? body.replace(/\{nombre\}/gi, firstSel.name.split(' ')[0]).replace(/\{nombre_completo\}/gi, firstSel.name).replace(/\{empresa\}/gi, firstSel.company || firstSel.name)
    : body;
  const days = Math.ceil(selected.size / Math.max(1, dailyLimit));

  async function create(start) {
    setSaving(true);
    try {
      const c = await api('/campaigns', { method: 'POST', body: {
        name, body, image: image || undefined, from_message_id: !image && useFromImage ? fromId : undefined,
        contact_ids: [...selected], min_delay: minDelay, max_delay: maxDelay, daily_limit: dailyLimit,
      } });
      if (start) await api(`/campaigns/${c.id}/start`, { method: 'POST' });
      toast(start ? 'Campaña iniciada' : 'Campaña guardada');
      navigate(`/campanas/${c.id}`);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <Link to="/campanas" className="muted small">← Campañas</Link>
      <h1>Nueva campaña</h1>
      <div className="grid-2">
        <section className="card form-grid" style={{ margin: 0, gridTemplateColumns: '1fr' }}>
          <label>Nombre de la campaña<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Seguimiento expo transporte" /></label>
          <label>Mensaje
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hola {nombre}, …" />
          </label>
          <div className="chips">
            {['{nombre}', '{empresa}', '{nombre_completo}'].map((v) => (
              <button type="button" key={v} className="chip" onClick={() => setBody(`${body}${v}`)}>{v}</button>
            ))}
          </div>
          <label>Imagen (opcional)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { setImage(await fileToDataUrl(f)); setUseFromImage(false); }
            }} />
          </label>
          {(image || fromImageUrl) && (
            <div className="row">
              <img src={image || fromImageUrl} alt="" style={{ maxHeight: 120, borderRadius: 6 }} />
              <button type="button" className="btn small" onClick={() => { setImage(null); setUseFromImage(false); }}>Quitar imagen</button>
            </div>
          )}
          <h3 style={{ marginTop: 8 }}>Seguridad del envío</h3>
          <div className="row wrap">
            <label>Pausa mínima (seg)<input type="number" min={15} value={minDelay} onChange={(e) => setMinDelay(Number(e.target.value))} /></label>
            <label>Pausa máxima (seg)<input type="number" min={minDelay} value={maxDelay} onChange={(e) => setMaxDelay(Number(e.target.value))} /></label>
            <label>Máximo por día<input type="number" min={1} max={200} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></label>
          </div>
          <p className="small muted">Recomendado con WhatsApp Web: pausas de 45–120 s y no más de 30–40 al día. {selected.size > 0 && `Con ${selected.size} destinatarios tardará unos ${days} día(s).`}</p>
        </section>

        <section className="card" style={{ margin: 0 }}>
          <h3>Vista previa {firstSel && <small className="muted">(para {firstSel.name})</small>}</h3>
          <div className="chat" style={{ height: 'auto', padding: 12, borderRadius: 8 }}>
            <div className="bubble out" style={{ maxWidth: '100%' }}>
              {(image || fromImageUrl) && <img className="media-img" src={image || fromImageUrl} alt="" />}
              <div className="bubble-text">{preview || <span className="muted">Escribe el mensaje…</span>}</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card mt">
        <div className="row between wrap">
          <h3 style={{ margin: 0 }}>Destinatarios ({selected.size} seleccionados)</h3>
          <div className="row wrap">
            <input placeholder="Buscar o filtrar por etiqueta (ej. evento, interes-alto, transporte)" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 320 }} />
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Todos los estatus</option>
              {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto', marginTop: 10 }}>
          <table>
            <thead><tr>
              <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Seleccionar todos los visibles" /></th>
              <th>Nombre</th><th>Empresa</th><th>WhatsApp</th><th>Estatus</th><th>Etiquetas</th>
            </tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => toggle(c.id)}>
                  <td><input type="checkbox" checked={selected.has(c.id)} readOnly /></td>
                  <td>{c.name}</td><td>{c.company || '—'}</td><td>{fmtPhone(c.phone)}</td>
                  <td><span className={`pill status-${c.status}`}>{LEAD_STATUS[c.status]}</span></td>
                  <td className="small muted">{c.tags || ''}</td>
                </tr>
              ))}
              {!contacts.length && <tr><td colSpan={6} className="muted center">Sin contactos con WhatsApp para este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="form-actions">
        <button className="btn" disabled={saving || !selected.size || !body.trim() || !name.trim()} onClick={() => create(false)}>Guardar como borrador</button>
        <button className="btn wa" disabled={saving || !selected.size || !body.trim() || !name.trim()} onClick={() => create(true)}>
          {saving ? 'Creando…' : `Iniciar envío a ${selected.size}`}
        </button>
      </div>
    </div>
  );
}

export function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const imgUrl = useBlobUrl(c?.media_path ? `/campaigns/${id}/media` : null);
  const load = () => api(`/campaigns/${id}`).then(setC).catch((e) => toast(e.message, 'err'));
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]); // eslint-disable-line

  if (!c) return <div className="page"><p className="muted">Cargando…</p></div>;
  const act = async (a) => {
    try { setC(await api(`/campaigns/${id}/${a}`, { method: 'POST' })); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async () => {
    if (!confirm('¿Borrar esta campaña? Los mensajes ya enviados se conservan en cada chat.')) return;
    await api(`/campaigns/${id}`, { method: 'DELETE' });
    navigate('/campanas');
  };

  return (
    <div className="page">
      <Link to="/campanas" className="muted small">← Campañas</Link>
      <div className="page-head">
        <h1>{c.name} <span className={`pill camp-${c.status}`}>{STATUS_LABEL[c.status]}</span></h1>
        <div className="row">
          {['borrador', 'pausada'].includes(c.status) && <button className="btn wa" onClick={() => act('start')}>▶ {c.status === 'pausada' ? 'Reanudar' : 'Iniciar envío'}</button>}
          {c.status === 'enviando' && <button className="btn" onClick={() => act('pause')}>⏸ Pausar</button>}
          {['borrador', 'enviando', 'pausada'].includes(c.status) && <button className="btn danger-outline" onClick={() => act('cancel')}>Cancelar</button>}
          {c.status !== 'enviando' && <button className="btn danger-outline" onClick={remove}>Borrar</button>}
        </div>
      </div>
      <div className="grid-2">
        <section className="card" style={{ margin: 0 }}>
          <Progress counts={c.counts} />
          <p className="small">
            Pausa entre mensajes: {c.min_delay}–{c.max_delay} s · Máximo {c.daily_limit} por día · Enviados hoy: {c.sentToday}
            {c.status === 'enviando' && c.nextSendAt && <><br />Siguiente envío: {new Date(c.nextSendAt).toLocaleTimeString('es-MX')}</>}
            {c.status === 'enviando' && c.sentToday >= c.daily_limit && <><br /><strong>Se alcanzó el límite de hoy; continúa mañana automáticamente.</strong></>}
          </p>
        </section>
        <section className="card" style={{ margin: 0 }}>
          {imgUrl && <img className="media-img" src={imgUrl} alt="" />}
          <div className="pre small">{c.body}</div>
        </section>
      </div>
      <section className="card mt table-wrap">
        <table>
          <thead><tr><th>Contacto</th><th>WhatsApp</th><th>Estatus</th><th>Enviado</th><th>Detalle</th></tr></thead>
          <tbody>
            {c.recipients.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/whatsapp/${r.contact_id}`}>{r.name}</Link><div className="muted small">{r.company}</div></td>
                <td>{fmtPhone(r.phone)}</td>
                <td><span className={`pill r-${r.status}`}>{R_LABEL[r.status]}</span></td>
                <td className="small">{r.sent_at ? fmtDateTime(r.sent_at) : '—'}</td>
                <td className="small muted">{r.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
