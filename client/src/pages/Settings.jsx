import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { toast } from '../components/Toast.jsx';
import ConnectWhatsApp from '../components/ConnectWhatsApp.jsx';
import BrandSettings, { InstallAppCard } from '../components/BrandSettings.jsx';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [s, setS] = useState(null);
  const [wa, setWa] = useState(null);

  useEffect(() => {
    api('/settings').then(setS);
    api('/whatsapp/status').then(setWa);
  }, []);
  if (!s) return <div className="page"><p className="muted">Cargando…</p></div>;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });

  async function save(e) {
    e.preventDefault();
    try { setS(await api('/settings', { method: 'PUT', body: s })); toast('Configuración guardada'); } catch (err) { toast(err.message, 'err'); }
  }
  const webhookUrl = `${window.location.origin}/api/whatsapp/webhook`;

  return (
    <div className="page">
      <h1>Configuración</h1>

      <InstallAppCard />
      <BrandSettings isAdmin={isAdmin} />

      <section className="card">
        <h3>Conexión con WhatsApp Business</h3>
        <ConnectWhatsApp status={wa} isAdmin={isAdmin} onChange={() => api('/whatsapp/status').then(setWa)} />
        {wa?.configured && !wa.signatureValidation && <div className="banner warn">⚠️ Configura <code>WHATSAPP_APP_SECRET</code> para validar la firma de los webhooks.</div>}
        <details>
          <summary className="muted small">Configuración técnica en Meta</summary>
        <ol className="steps">
          <li>En <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">Meta for Developers</a> crea una app tipo <em>Business</em> y agrega el producto <strong>WhatsApp</strong>.</li>
          <li>Registra el número de SecureFleet en WhatsApp Manager y copia el <strong>Phone Number ID</strong> y el <strong>WhatsApp Business Account ID</strong>.</li>
          <li>Crea un <strong>usuario del sistema</strong> en el Business Manager y genera un token permanente con permisos <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
          <li>En WhatsApp → Configuración → Webhook, usa la URL <code className="copy" onClick={() => { navigator.clipboard?.writeText(webhookUrl); toast('URL copiada'); }}>{webhookUrl}</code> y el token de verificación que pusiste en <code>WHATSAPP_VERIFY_TOKEN</code>. Suscríbete a los campos <strong>messages</strong>, <strong>smb_message_echoes</strong>, <strong>history</strong> y <strong>smb_app_state_sync</strong> (los últimos tres son para coexistencia con la app del celular).</li>
          <li>Crea y aprueba plantillas (ej. <em>seguimiento_cotizacion</em>) para escribir a clientes fuera de la ventana de 24 h.</li>
        </ol>
        </details>
      </section>

      <form onSubmit={save}>
        <section className="card form-grid">
          <h3 className="span-2">Datos de la empresa (aparecen en las cotizaciones)</h3>
          <label>Nombre comercial<input value={s.company_name} onChange={set('company_name')} disabled={!isAdmin} /></label>
          <label>Razón social<input value={s.company_legal_name} onChange={set('company_legal_name')} disabled={!isAdmin} /></label>
          <label>RFC<input value={s.company_rfc} onChange={set('company_rfc')} disabled={!isAdmin} /></label>
          <label>Teléfono<input value={s.company_phone} onChange={set('company_phone')} disabled={!isAdmin} /></label>
          <label>Email<input value={s.company_email} onChange={set('company_email')} disabled={!isAdmin} /></label>
          <label>Sitio web<input value={s.company_website} onChange={set('company_website')} disabled={!isAdmin} /></label>
          <label className="span-2">Dirección<input value={s.company_address} onChange={set('company_address')} disabled={!isAdmin} /></label>
          <label>Lema bajo el nombre<input value={s.company_tagline || ''} onChange={set('company_tagline')} disabled={!isAdmin} placeholder="FLEET INTELLIGENCE" /></label>
          <label>Frase del encabezado<input value={s.company_slogan || ''} onChange={set('company_slogan')} disabled={!isAdmin} placeholder="Seguridad Patrimonial y Monitoreo de Flotas" /></label>
        </section>

        <section className="card form-grid">
          <h3 className="span-2">Cotizaciones</h3>
          <label>Prefijo de folio<input value={s.quote_prefix} onChange={set('quote_prefix')} disabled={!isAdmin} /></label>
          <label>Vigencia (días)<input type="number" min="1" value={s.quote_validity_days} onChange={set('quote_validity_days')} disabled={!isAdmin} /></label>
          <label>Moneda por defecto<select value={s.default_currency} onChange={set('default_currency')} disabled={!isAdmin}><option>MXN</option><option>USD</option></select></label>
          <label>Etiqueta del pago único<input value={s.quote_label_initial || ''} onChange={set('quote_label_initial')} disabled={!isAdmin} placeholder="INVERSIÓN INICIAL" /></label>
          <label>Etiqueta del pago mensual<input value={s.quote_label_monthly || ''} onChange={set('quote_label_monthly')} disabled={!isAdmin} placeholder="SERVICIO MENSUAL" /></label>
          <label className="span-2">Condiciones por defecto (una por renglón)<textarea rows={5} value={s.quote_terms} onChange={set('quote_terms')} disabled={!isAdmin} /></label>
        </section>

        <section className="card form-grid">
          <h3 className="span-2">Automatizaciones de WhatsApp</h3>
          <label className="check span-2"><input type="checkbox" checked={s.wa_auto_create_leads === '1'} onChange={set('wa_auto_create_leads')} disabled={!isAdmin} /> Crear un lead automáticamente cuando escriba un número nuevo</label>
          <label className="span-2">Mensaje de bienvenida automático para leads nuevos (vacío = desactivado)
            <textarea rows={2} value={s.wa_welcome_message} onChange={set('wa_welcome_message')} disabled={!isAdmin} placeholder="¡Hola! Gracias por escribir a SecureFleet. Un asesor te atenderá en breve." />
          </label>
          <label>Idioma de plantillas<input value={s.wa_template_language} onChange={set('wa_template_language')} disabled={!isAdmin} /></label>
          {isAdmin && <div className="form-actions span-2"><button className="btn primary">Guardar configuración</button></div>}
        </section>
      </form>

      <QuickReplies />
      {isAdmin && <Users me={user} />}
      <ChangePassword />
    </div>
  );
}

function QuickReplies() {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ shortcut: '/', body: '' });
  const load = () => api('/whatsapp/quick-replies').then(setRows);
  useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault();
    await api('/whatsapp/quick-replies', { method: 'POST', body: f });
    setF({ shortcut: '/', body: '' });
    load();
  }
  return (
    <section className="card">
      <h3>Respuestas rápidas de WhatsApp</h3>
      <p className="muted small">Escribe el atajo (ej. <code>/demo</code>) en el chat para insertar el texto.</p>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.id}><code>{r.shortcut}</code><div>{r.body}</div>
            <button className="btn-icon" onClick={async () => { await api(`/whatsapp/quick-replies/${r.id}`, { method: 'DELETE' }); load(); }}>✕</button></li>
        ))}
      </ul>
      <form className="row" onSubmit={add}>
        <input required style={{ maxWidth: 140 }} value={f.shortcut} onChange={(e) => setF({ ...f, shortcut: e.target.value })} />
        <input required className="grow" placeholder="Texto de la respuesta" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <button className="btn">Agregar</button>
      </form>
    </section>
  );
}

function Users({ me }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'ventas' });
  const load = () => api('/users').then(setRows);
  useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault();
    try { await api('/users', { method: 'POST', body: f }); setF({ name: '', email: '', password: '', role: 'ventas' }); load(); toast('Usuario creado'); }
    catch (err) { toast(err.message, 'err'); }
  }
  async function update(u, body) {
    try { await api(`/users/${u.id}`, { method: 'PUT', body }); load(); } catch (err) { toast(err.message, 'err'); }
  }
  return (
    <section className="card">
      <h3>Equipo de ventas</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th><th /></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td>
                <td><select value={u.role} disabled={u.id === me.id} onChange={(e) => update(u, { role: e.target.value })}><option value="ventas">Ventas</option><option value="admin">Admin</option></select></td>
                <td><input type="checkbox" checked={Boolean(u.active)} disabled={u.id === me.id} onChange={(e) => update(u, { active: e.target.checked })} /></td>
                <td><button className="btn small" onClick={() => { const p = prompt(`Nueva contraseña para ${u.name} (mín. 8)`); if (p) update(u, { password: p }); }}>Restablecer contraseña</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="row wrap mt" onSubmit={add}>
        <input required placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input required type="email" placeholder="Correo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input required type="password" minLength={8} placeholder="Contraseña (mín. 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="ventas">Ventas</option><option value="admin">Admin</option></select>
        <button className="btn primary">Agregar usuario</button>
      </form>
    </section>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ current: '', next: '' });
  async function submit(e) {
    e.preventDefault();
    try { await api('/auth/password', { method: 'POST', body: f }); setF({ current: '', next: '' }); toast('Contraseña actualizada'); }
    catch (err) { toast(err.message, 'err'); }
  }
  return (
    <section className="card">
      <h3>Mi contraseña</h3>
      <form className="row wrap" onSubmit={submit}>
        <input required type="password" placeholder="Actual" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        <input required type="password" minLength={8} placeholder="Nueva (mín. 8)" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        <button className="btn">Cambiar</button>
      </form>
    </section>
  );
}
