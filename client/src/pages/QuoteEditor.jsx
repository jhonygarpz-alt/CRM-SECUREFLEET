import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, openQuotePdf } from '../api.js';
import { money, BILLING, QUOTE_STATUS, fmtDateTime } from '../format.js';
import Modal from '../components/Modal.jsx';
import { toast } from '../components/Toast.jsx';

const blankItem = () => ({ product_id: null, description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_rate: 0.16, billing: 'unico' });

function calc(items) {
  let subtotal = 0, discount = 0, tax = 0, recurring = 0;
  for (const it of items) {
    const gross = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    const d = gross * ((Number(it.discount_pct) || 0) / 100);
    const t = (gross - d) * Number(it.tax_rate ?? 0.16);
    subtotal += gross; discount += d; tax += t;
    if (it.billing !== 'unico') recurring += gross - d + t;
  }
  return { subtotal, discount, tax, total: subtotal - discount + tax, recurring };
}

export default function QuoteEditor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  useEffect(() => {
    api('/contacts').then(setContacts);
    api('/products?active=1').then(setProducts);
    if (id) {
      api(`/quotes/${id}`).then(setQuote).catch((e) => toast(e.message, 'err'));
    } else {
      api('/settings').then((s) => setQuote({
        contact_id: search.get('contact') ? Number(search.get('contact')) : '',
        deal_id: search.get('deal') ? Number(search.get('deal')) : '',
        status: 'borrador', currency: s.default_currency || 'MXN', notes: '', terms: s.quote_terms, valid_until: '', items: [blankItem()],
      }));
    }
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (quote?.contact_id) api(`/deals?contact_id=${quote.contact_id}`).then(setDeals);
    else setDeals([]);
  }, [quote?.contact_id]);

  const totals = useMemo(() => calc(quote?.items || []), [quote?.items]);
  if (!quote) return <div className="page"><p className="muted">Cargando…</p></div>;

  const set = (k) => (e) => setQuote({ ...quote, [k]: e.target.value });
  const setItem = (i, k, v) => setQuote({ ...quote, items: quote.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });
  const addProduct = (pid) => {
    const p = products.find((x) => x.id === Number(pid));
    if (!p) return;
    const item = { product_id: p.id, description: p.description ? `${p.name} — ${p.description}` : p.name, quantity: 1,
      unit_price: p.price, discount_pct: 0, tax_rate: p.tax_rate, billing: p.billing };
    const items = quote.items.length === 1 && !quote.items[0].description ? [item] : [...quote.items, item];
    setQuote({ ...quote, items });
  };
  const applyUnitsToAll = () => {
    const deal = deals.find((d) => d.id === Number(quote.deal_id));
    const contact = contacts.find((c) => c.id === Number(quote.contact_id));
    const units = deal?.units || contact?.fleet_size;
    if (!units) return toast('La oportunidad/contacto no tiene número de unidades', 'err');
    setQuote({ ...quote, items: quote.items.map((it) => ({ ...it, quantity: units })) });
  };

  async function save(extra = {}) {
    setSaving(true);
    try {
      const body = {
        contact_id: Number(quote.contact_id), deal_id: quote.deal_id ? Number(quote.deal_id) : null, status: quote.status,
        valid_until: quote.valid_until || undefined, currency: quote.currency, notes: quote.notes, terms: quote.terms,
        items: quote.items.filter((it) => it.description.trim()), ...extra,
      };
      const saved = id ? await api(`/quotes/${id}`, { method: 'PUT', body }) : await api('/quotes', { method: 'POST', body });
      setQuote(saved);
      toast('Cotización guardada');
      if (!id) navigate(`/cotizaciones/${saved.id}`, { replace: true });
      return saved;
    } catch (e) {
      toast(e.message, 'err');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    const q = await api(`/quotes/${id}/duplicate`, { method: 'POST' });
    toast(`Duplicada como ${q.folio}`);
    navigate(`/cotizaciones/${q.id}`);
  }
  async function remove() {
    if (!confirm('¿Eliminar esta cotización?')) return;
    await api(`/quotes/${id}`, { method: 'DELETE' });
    navigate('/cotizaciones');
  }

  const contact = contacts.find((c) => c.id === Number(quote.contact_id));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/cotizaciones" className="muted small">← Cotizaciones</Link>
          <h1>{quote.folio || 'Nueva cotización'} {quote.id && <span className={`pill q-${quote.status}`}>{QUOTE_STATUS[quote.status]}</span>}</h1>
          {quote.sent_at && <div className="muted small">Última vez enviada por WhatsApp: {fmtDateTime(quote.sent_at)}</div>}
        </div>
        <div className="row">
          {quote.id && <>
            <button className="btn" onClick={() => openQuotePdf(quote.id)}>Ver PDF</button>
            <button className="btn wa" onClick={() => setSendOpen(true)} disabled={!contact?.phone}>💬 Enviar por WhatsApp</button>
            <button className="btn" onClick={duplicate}>Duplicar</button>
          </>}
          <button className="btn primary" onClick={() => save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      <div className="card form-grid three">
        <label>Cliente *
          <select value={quote.contact_id || ''} onChange={(e) => setQuote({ ...quote, contact_id: e.target.value, deal_id: '' })} required>
            <option value="">Selecciona…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.company} — ${c.name}` : c.name}</option>)}
          </select>
        </label>
        <label>Oportunidad
          <select value={quote.deal_id || ''} onChange={set('deal_id')}>
            <option value="">(ninguna)</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
        <label>Estatus
          <select value={quote.status} onChange={set('status')}>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Vigencia hasta<input type="date" value={quote.valid_until || ''} onChange={set('valid_until')} placeholder="automática" /></label>
        <label>Moneda<select value={quote.currency} onChange={set('currency')}><option>MXN</option><option>USD</option></select></label>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Partidas</h3>
          <div className="row">
            <select value="" onChange={(e) => addProduct(e.target.value)}>
              <option value="">+ Agregar del catálogo…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}{p.billing !== 'unico' ? ` / ${BILLING[p.billing].toLowerCase()}` : ''}</option>)}
            </select>
            <button className="btn" onClick={() => setQuote({ ...quote, items: [...quote.items, blankItem()] })}>+ Partida libre</button>
            <button className="btn" onClick={applyUnitsToAll} title="Usa el número de unidades de la oportunidad o del contacto">Cantidad = unidades de flotilla</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="items">
            <thead><tr><th>Concepto</th><th>Cobro</th><th>Cant.</th><th>P. unitario</th><th>Desc. %</th><th>IVA</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>
              {quote.items.map((it, i) => {
                const gross = it.quantity * it.unit_price;
                return (
                  <tr key={i}>
                    <td><textarea rows={2} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Descripción" /></td>
                    <td><select value={it.billing} onChange={(e) => setItem(i, 'billing', e.target.value)}>{Object.entries(BILLING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td><input type="number" min="0" step="any" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} /></td>
                    <td><input type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} /></td>
                    <td><input type="number" min="0" max="100" step="0.5" value={it.discount_pct} onChange={(e) => setItem(i, 'discount_pct', e.target.value)} /></td>
                    <td><select value={it.tax_rate} onChange={(e) => setItem(i, 'tax_rate', Number(e.target.value))}><option value={0.16}>16%</option><option value={0.08}>8%</option><option value={0}>0%</option></select></td>
                    <td className="num">{money(gross * (1 - (it.discount_pct || 0) / 100), quote.currency)}</td>
                    <td><button className="btn-icon" onClick={() => setQuote({ ...quote, items: quote.items.filter((_, j) => j !== i) })} title="Quitar">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="totals">
          <div><span>Subtotal</span><span>{money(totals.subtotal, quote.currency)}</span></div>
          {totals.discount > 0 && <div><span>Descuento</span><span>-{money(totals.discount, quote.currency)}</span></div>}
          <div><span>IVA</span><span>{money(totals.tax, quote.currency)}</span></div>
          <div className="grand"><span>Total</span><span>{money(totals.total, quote.currency)}</span></div>
          {totals.recurring > 0 && <small className="muted">Incluye {money(totals.recurring, quote.currency)} de servicios recurrentes</small>}
        </div>
      </div>

      <div className="card form-grid">
        <label className="span-2">Notas para el cliente<textarea rows={2} value={quote.notes || ''} onChange={set('notes')} /></label>
        <label className="span-2">Términos y condiciones<textarea rows={3} value={quote.terms || ''} onChange={set('terms')} /></label>
      </div>

      {quote.id && <button className="btn danger-outline" onClick={remove}>Eliminar cotización</button>}

      {sendOpen && <SendModal quote={quote} contact={contact} onClose={() => setSendOpen(false)} beforeSend={() => save()} onSent={(q) => { setQuote(q); setSendOpen(false); }} />}
    </div>
  );
}

function SendModal({ quote, contact, onClose, beforeSend, onSent }) {
  const first = contact?.name?.split(' ')[0] || '';
  const [msg, setMsg] = useState(`Hola ${first}, te comparto la cotización ${quote.folio} por ${money(quote.total, quote.currency)}. Quedo atento a tus comentarios.`);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const saved = await beforeSend();
      if (!saved) return;
      const r = await api(`/quotes/${quote.id}/send-whatsapp`, { method: 'POST', body: { message: msg } });
      toast(r.simulated ? 'Enviada (modo simulación)' : 'Cotización enviada por WhatsApp ✅');
      onSent(r.quote);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Enviar cotización por WhatsApp" onClose={onClose}>
      <p>Se enviará el PDF <strong>{quote.folio}.pdf</strong> a <strong>{contact?.name}</strong> (+{contact?.phone}).</p>
      <label>Mensaje<textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
      <p className="muted small">WhatsApp solo permite enviar documentos si el cliente te escribió en las últimas 24 h. Si no, primero envía una plantilla desde el chat.</p>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn wa" onClick={send} disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</button>
      </div>
    </Modal>
  );
}
