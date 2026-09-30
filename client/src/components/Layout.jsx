import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App.jsx';
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
    document.title = unread > 0 ? `(${unread}) SecureFleet CRM` : 'SecureFleet CRM';
  }, [unread]);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">SF</span>
          <div>
            <strong>SecureFleet</strong>
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
          <strong>SecureFleet CRM</strong>
        </header>
        <Outlet />
      </div>
      {open && <div className="backdrop" onClick={() => setOpen(false)} />}
      <Toaster />
    </div>
  );
}
