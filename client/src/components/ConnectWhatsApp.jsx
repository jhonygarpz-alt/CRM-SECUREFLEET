import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { toast } from './Toast.jsx';

/** Carga el SDK de Facebook una sola vez. */
function loadFacebookSdk({ appId, apiVersion }) {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: apiVersion });
      resolve(window.FB);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/es_LA/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('No se pudo cargar el SDK de Facebook (¿bloqueador de anuncios?)'));
    document.body.appendChild(s);
  });
}

/**
 * Botón "Conectar WhatsApp" con el registro integrado de Meta en modo coexistencia:
 * el número sigue funcionando en la app WhatsApp Business del celular.
 */
export default function ConnectWhatsApp({ status, onChange, isAdmin }) {
  const [busy, setBusy] = useState(false);
  const session = useRef({});

  useEffect(() => {
    const onMessage = (event) => {
      if (!String(event.origin).endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (String(data.event).startsWith('FINISH')) session.current = { ...session.current, ...data.data };
        if (data.event === 'CANCEL') session.current.cancelled = data.data?.current_step || true;
        if (data.event === 'ERROR') session.current.error = data.data?.error_message;
      } catch {
        /* mensajes ajenos al registro */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!status) return null;

  async function connect() {
    setBusy(true);
    session.current = {};
    try {
      const FB = await loadFacebookSdk(status.signup);
      FB.login(
        (response) => {
          const code = response?.authResponse?.code;
          if (!code) {
            setBusy(false);
            toast(session.current.error || 'Conexión cancelada', 'err');
            return;
          }
          // El evento FINISH puede llegar un instante después del callback.
          setTimeout(() => {
            api('/whatsapp/embedded-signup', {
              method: 'POST',
              body: { code, waba_id: session.current.waba_id, phone_number_id: session.current.phone_number_id, coexistence: true },
            })
              .then((r) => { toast(`✅ WhatsApp conectado ${r.displayPhone || ''}`); onChange(); })
              .catch((e) => toast(e.message, 'err'))
              .finally(() => setBusy(false));
          }, 800);
        },
        {
          config_id: status.signup.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
        },
      );
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('¿Desconectar WhatsApp del CRM? Tu app del celular seguirá funcionando.')) return;
    await api('/whatsapp/disconnect', { method: 'POST' });
    onChange();
  }

  if (status.connectedVia === 'embedded_signup') {
    const daysLeft = status.connectedAt
      ? Math.ceil(status.tokenDays - (Date.now() - new Date(status.connectedAt).getTime()) / 86400000)
      : null;
    const expiring = daysLeft !== null && daysLeft <= 10;
    return (
      <div className={`banner ${expiring ? 'warn' : 'ok'}`}>
        {daysLeft !== null && (
          <div style={{ marginBottom: 6 }}>
            {daysLeft > 0
              ? `La autorización de Meta vence en ${daysLeft} día(s).`
              : 'La autorización de Meta venció: los mensajes no se enviarán hasta reconectar.'}
            {isAdmin && expiring && status.signup && (
              <button className="btn small wa" style={{ marginLeft: 12 }} onClick={connect} disabled={busy}>
                {busy ? 'Conectando…' : 'Reconectar WhatsApp'}
              </button>
            )}
          </div>
        )}
        ✅ Conectado: <strong>{status.displayPhone}</strong> {status.verifiedName && `· ${status.verifiedName}`}
        {status.coexistence && ' · modo coexistencia (también funciona en tu celular)'}
        {isAdmin && <button className="btn small danger-outline" style={{ marginLeft: 12 }} onClick={disconnect}>Desconectar</button>}
      </div>
    );
  }
  if (status.configured) {
    return status.provider === '360dialog'
      ? <div className="banner ok">✅ WhatsApp conectado mediante <strong>360dialog</strong> (proveedor oficial de Meta) · tu número también sigue funcionando en la app del celular.</div>
      : <div className="banner ok">✅ Conectado a la API de WhatsApp Cloud · Phone Number ID <code>{status.phoneNumberId}</code></div>;
  }
  if (!status.signup) {
    return (
      <div className="banner warn">
        ⚠️ Modo simulación. Para activar el botón <strong>Conectar WhatsApp</strong> falta configurar la app de Meta en el servidor
        (<code>WHATSAPP_APP_ID</code>, <code>WHATSAPP_APP_SECRET</code> y <code>WHATSAPP_CONFIG_ID</code>).
      </div>
    );
  }
  return (
    <div className="banner warn">
      <p style={{ margin: '0 0 10px' }}>
        ⚠️ WhatsApp aún no está conectado. Conecta tu número de <strong>WhatsApp Business</strong>: seguirá funcionando en tu celular
        y los mensajes se sincronizarán con el CRM.
      </p>
      {isAdmin
        ? <button className="btn wa" onClick={connect} disabled={busy}>{busy ? 'Conectando…' : '💬 Conectar WhatsApp Business'}</button>
        : <em>Pide a un administrador que conecte WhatsApp.</em>}
    </div>
  );
}
