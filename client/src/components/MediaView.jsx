import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Muestra el audio, imagen, video o documento de un mensaje de WhatsApp (requiere sesión, por eso se descarga con el token). */
export default function MediaView({ message }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(false);
  const mime = String(message.media_mime || '');

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    api(`/whatsapp/media/${message.id}`, { raw: true })
      .then((res) => res.blob())
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id]);

  if (error) return <div className="small muted">No se pudo cargar el archivo</div>;
  if (!url) return <div className="small muted">Cargando archivo…</div>;
  if (mime.startsWith('audio/')) return <audio className="media-audio" controls preload="metadata" src={url} />;
  if (mime.startsWith('image/')) {
    return <a href={url} target="_blank" rel="noreferrer"><img className="media-img" src={url} alt="Imagen" /></a>;
  }
  if (mime.startsWith('video/')) return <video className="media-img" controls preload="metadata" src={url} />;
  return <a className="doc" href={url} target="_blank" rel="noreferrer" download={message.filename || undefined}>📄 {message.filename || 'Abrir documento'}</a>;
}
