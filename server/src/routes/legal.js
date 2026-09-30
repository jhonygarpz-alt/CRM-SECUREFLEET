import { Router } from 'express';
import { getSettings } from '../db.js';

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1c2433}
h1{color:#0b3d91}h2{margin-top:28px;font-size:18px}small{color:#6b7587}</style></head><body>${body}</body></html>`;
}

/** Páginas públicas requeridas por Meta: aviso de privacidad, términos y eliminación de datos. */
export default function legalRoutes(db) {
  const r = Router();
  const info = () => {
    const s = getSettings(db);
    return {
      name: esc(s.company_name || 'SecureFleet'),
      legal: esc(s.company_legal_name || s.company_name || 'SecureFleet'),
      email: esc(s.company_email || ''),
      phone: esc(s.company_phone || ''),
      address: esc(s.company_address || ''),
    };
  };

  r.get('/privacidad', (_req, res) => {
    const c = info();
    res.send(page(`Aviso de privacidad · ${c.name}`, `<h1>Aviso de privacidad</h1>
<p><strong>${c.legal}</strong> (“${c.name}”), con domicilio en ${c.address || 'México'}, es responsable del tratamiento de los datos personales que nos proporcionas, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.</p>
<h2>Datos que recabamos</h2><p>Nombre, empresa, puesto, teléfono, número de WhatsApp, correo electrónico, ciudad, características de tu flotilla y el contenido de las conversaciones que sostienes con nosotros por WhatsApp u otros medios.</p>
<h2>Finalidades</h2><p>Atender tus solicitudes de información, elaborar y enviarte cotizaciones, dar seguimiento comercial, prestar los servicios contratados de rastreo y administración de flotillas, y brindarte soporte. No vendemos ni compartimos tus datos con terceros para fines de mercadotecnia.</p>
<h2>WhatsApp</h2><p>Usamos la plataforma WhatsApp Business de Meta para comunicarnos contigo. Los mensajes se almacenan en nuestro sistema de gestión de clientes (CRM) para dar continuidad a la atención. Puedes pedir en cualquier momento que dejemos de escribirte por este medio.</p>
<h2>Derechos ARCO</h2><p>Puedes acceder, rectificar, cancelar u oponerte al uso de tus datos, o revocar tu consentimiento, escribiendo a ${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : 'nuestro correo de contacto'}${c.phone ? ` o llamando al ${c.phone}` : ''}. Consulta también nuestras <a href="/eliminacion-de-datos">instrucciones de eliminación de datos</a>.</p>
<h2>Cambios</h2><p>Cualquier cambio a este aviso se publicará en esta misma página.</p><small>${c.name}</small>`));
  });

  r.get('/terminos', (_req, res) => {
    const c = info();
    res.send(page(`Términos del servicio · ${c.name}`, `<h1>Términos del servicio</h1>
<p>Al comunicarte con <strong>${c.name}</strong> por WhatsApp, correo o teléfono aceptas recibir información comercial relacionada con tu solicitud, cotizaciones y seguimiento de nuestros productos y servicios de rastreo satelital y administración de flotillas.</p>
<p>Las cotizaciones tienen la vigencia indicada en cada documento y los precios están sujetos a cambio sin previo aviso. La contratación de servicios se rige por el contrato correspondiente.</p>
<p>El uso de tus datos personales se describe en nuestro <a href="/privacidad">aviso de privacidad</a>.</p><small>${c.name}</small>`));
  });

  r.get('/eliminacion-de-datos', (_req, res) => {
    const c = info();
    res.send(page(`Eliminación de datos · ${c.name}`, `<h1>Instrucciones para eliminar tus datos</h1>
<p>Para solicitar que eliminemos tus datos personales y el historial de conversaciones que tenemos contigo:</p>
<ol><li>Envía un mensaje por WhatsApp con el texto <strong>“ELIMINAR MIS DATOS”</strong>, o escribe a ${c.email ? `<a href="mailto:${c.email}">${c.email}</a>` : 'nuestro correo de contacto'}.</li>
<li>Indica tu nombre y el número de teléfono con el que te comunicaste.</li>
<li>Eliminaremos tu información de nuestro CRM en un plazo máximo de 20 días hábiles y te confirmaremos por el mismo medio.</li></ol>
<p>Más información en nuestro <a href="/privacidad">aviso de privacidad</a>.</p><small>${c.name}</small>`));
  });

  return r;
}
