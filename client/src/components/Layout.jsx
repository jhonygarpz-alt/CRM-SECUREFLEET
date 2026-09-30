import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth, useBrand, logoUrl } from '../App.jsx';
import { api } from '../api.js';
import { Toaster } from './Toast.jsx';

const NAV = [
  ['/', '📊', 'Tablero'],
  ['/contactos', '👥', 'Leads y clientes'],
  ['/pipeline', '🧭', 'Pipeline de ventas'],
  ['/whatsapp', '💬', 'WhatsApp'],
  ['/seguimientos', '⏰', 'Seguimientos'],
  ['/cotizaciones', '🧾', 'Cotizaciones'],
  ['/catalogo', '📦', 'Catálogo'],
  ['/configuracion', '⚙️', 'Configuración'],
];

export default function Layout() {
  const { user, logout } = useAuth();
  const brand = useBrand();
  const [canInstall, setCanInstall] = useState(Boolean(window.__installPrompt));
  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('installable', on);
    return () => window.removeEventListener('installable', on);
  }, []);
  async function install() {
    const p = window.__installPrompt;
    if (!p) return;
    p.prompt();
    await p.userChoice.catch(() => {});
    window.__installPrompt = null;
    setCanInstall(false);
  }
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () => api('/whatsapp/unread').then((r) => alive && setUnread(r.total)).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${brand.name} CRM` : `${brand.name} CRM`;
  }, [unread, brand.name]);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src={logoUrl(brand)} alt="" />
          <div>
            <strong>{brand.name}</strong>
            <small>CRM comercial</small>
          </div>
        </div>
        <nav onClick={() => setOpen(false)}>
          {NAV.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
              {to === '/whatsapp' && unread > 0 && <span className="badge-count">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        {canInstall && (
          <button className="install-btn" onClick={install}>📲 Instalar app</button>
        )}
        <div className="sidebar-foot">
          <div>
            <strong>{user.name}</strong>
            <small>{user.role === 'admin' ? 'Administrador' : 'Ventas'}</small>
          </div>
          <button className="btn-link" onClick={logout}>Salir</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar-mobile">
          <button className="btn-icon" onClick={() => setOpen(!open)} aria-label="Menú">☰</button>
          <img className="brand-logo small" src={logoUrl(brand)} alt="" />
          <strong>{brand.name} CRM</strong>
        </header>
        <Outlet />
      </div>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <Toaster />
    </div>
  );
}
