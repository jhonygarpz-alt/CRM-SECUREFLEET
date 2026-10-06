import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from './Toast.jsx';

/** Vinculación tipo WhatsApp Web: muestra el QR y el estado de la conexión. */
export default function WaWebPanel({ isAdmin }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    const tick = () => api('/whatsapp/web').then((r) => alive && setS(r)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [isAdmin]);

  async function logout() {
    if (!confirm('¿Desvincular WhatsApp del CRM? Tu app del celular seguirá funcionando normal.')) return;
    await api('/whatsapp/web/logout', { method: 'POST' });
    toast('WhatsApp desvinculado');
  }

  if (!isAdmin) return <div className="banner ok">WhatsApp conectado en modo WhatsApp Web.</div>;
  if (!s) return <div className="banner warn">Consultando WhatsApp…</div>;

  if (s.state === 'connected') {
    return (
      <div className="banner ok">
        ✅ WhatsApp vinculado: <strong>+{s.me}</strong> (modo WhatsApp Web; tu celular sigue funcionando normal).
        <button className="btn small danger-outline" style={{ marginLeft: 12 }} onClick={logout}>Desvincular</button>
        <div className="small" style={{ marginTop: 6 }}>
          Úsalo para atender y dar seguimiento uno a uno. Evita mensajes masivos o idénticos a muchos contactos: WhatsApp podría bloquear el número.
        </div>
      </div>
    );
  }

  return (
    <div className="banner warn">
      <div className="logo-editor" style={{ alignItems: 'flex-start' }}>
        <div className="center">
          {s.qr
            ? <img src={s.qr} alt="Código QR" style={{ width: 240, height: 240, background: '#fff', borderRadius: 8, padding: 6 }} />
            : <div style={{ width: 240, height: 240, display: 'grid', placeItems: 'center', background: '#fff', borderRadius: 8 }}>Generando código…</div>}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>Vincula tu WhatsApp Business</strong>
          <ol className="steps">
            <li>En tu celular abre <strong>WhatsApp Business</strong>.</li>
            <li>Toca <strong>⋮ (o Configuración) → Dispositivos vinculados → Vincular un dispositivo</strong>.</li>
            <li>Escanea este código. Se actualiza solo cada pocos segundos.</li>
          </ol>
          <p className="small">Tu celular sigue funcionando igual. Los mensajes nuevos que recibas o contestes desde el celular aparecerán en el CRM.</p>
          {s.lastError && <p className="small muted">Último aviso: {s.lastError}</p>}
        </div>
      </div>
    </div>
  );
}
