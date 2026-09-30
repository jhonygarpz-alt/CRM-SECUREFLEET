import { useState } from 'react';
import { api } from '../api.js';
import { useBrand, logoUrl } from '../App.jsx';
import { toast } from './Toast.jsx';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

/** Dibuja la imagen ajustada dentro de un lienzo (opcionalmente cuadrado con fondo y margen). */
function render(img, { size, square, background, padding = 0 }) {
  const ratio = img.width / img.height;
  let w = size;
  let h = size;
  if (!square) {
    if (ratio >= 1) h = Math.round(size / ratio);
    else w = Math.round(size * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  const box = (square ? size : Math.max(w, h)) * (1 - padding * 2);
  const dw = ratio >= 1 ? box : box * ratio;
  const dh = ratio >= 1 ? box / ratio : box;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - Math.min(dw, w)) / 2, (h - Math.min(dh, h)) / 2, Math.min(dw, w), Math.min(dh, h));
  return canvas.toDataURL('image/png');
}

export default function BrandSettings({ isAdmin }) {
  const brand = useBrand();
  const [img, setImg] = useState(null);
  const [bg, setBg] = useState('#0a1f44');
  const [saving, setSaving] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return toast('Usa una imagen PNG, JPG, WEBP o SVG', 'err');
    try {
      setImg(await loadImage(file));
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api('/branding/logo', {
        method: 'PUT',
        body: {
          logo: render(img, { size: 600 }),
          icon192: render(img, { size: 192, square: true, background: bg, padding: 0.12 }),
          icon512: render(img, { size: 512, square: true, background: bg, padding: 0.12 }),
        },
      });
      toast('Logo actualizado ✅');
      setImg(null);
      brand.refresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('¿Volver al logo predeterminado?')) return;
    await api('/branding/logo', { method: 'DELETE' });
    brand.refresh();
    toast('Se restauró el logo predeterminado');
  }

  const iconPreview = img ? render(img, { size: 128, square: true, background: bg, padding: 0.12 }) : `/branding/icon-192.png?v=${brand.version}`;

  return (
    <section className="card">
      <h3>Logo e identidad</h3>
      <p className="muted small">Se usa en el menú, la pantalla de acceso, el ícono de la app en el celular y el encabezado de las propuestas en PDF.</p>
      <div className="logo-editor">
        <div className="center">
          <img className="logo-preview" src={img ? img.src : logoUrl(brand)} alt="Logo" />
          <div className="muted small">Logo</div>
        </div>
        <div className="center">
          <img className="icon-preview" src={iconPreview} alt="Ícono" />
          <div className="muted small">Ícono de la app</div>
        </div>
        {isAdmin && (
          <div className="stack" style={{ marginTop: 0, minWidth: 220 }}>
            <label>Subir logo (PNG con fondo transparente recomendado)
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={pick} />
            </label>
            <label>Color de fondo del ícono
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ height: 38, padding: 2 }} />
            </label>
            <div className="row">
              <button className="btn primary" disabled={!img || saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar logo'}</button>
              {brand.customLogo && <button className="btn" onClick={reset}>Restaurar predeterminado</button>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function InstallAppCard() {
  const [canInstall, setCanInstall] = useState(Boolean(window.__installPrompt));
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  async function install() {
    const p = window.__installPrompt;
    if (!p) return;
    p.prompt();
    await p.userChoice.catch(() => {});
    window.__installPrompt = null;
    setCanInstall(false);
  }
  return (
    <section className="card">
      <h3>📲 App en tu celular</h3>
      {standalone ? (
        <p>✅ Estás usando el CRM como app instalada.</p>
      ) : (
        <>
          {canInstall && <p><button className="btn primary" onClick={install}>Instalar app en este dispositivo</button></p>}
          <ol className="steps">
            <li><strong>Android (Chrome):</strong> abre el CRM en Chrome → menú <strong>⋮</strong> → <strong>Instalar app</strong> (o "Agregar a pantalla principal").</li>
            <li><strong>iPhone (Safari):</strong> abre el CRM en Safari → botón <strong>Compartir</strong> ⬆️ → <strong>Agregar a pantalla de inicio</strong> → Agregar.</li>
            <li><strong>Computadora (Chrome / Edge):</strong> ícono de instalar ⊕ al final de la barra de direcciones → <strong>Instalar</strong>.</li>
          </ol>
          <p className="muted small">La app se abre a pantalla completa con tu logo, sin barra del navegador, y se actualiza sola cada vez que se publica una mejora.</p>
        </>
      )}
    </section>
  );
}
