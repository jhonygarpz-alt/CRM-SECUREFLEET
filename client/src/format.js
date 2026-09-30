export const money = (n, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n) || 0);

/** Fechas de SQLite ('YYYY-MM-DD HH:MM:SS' en UTC) o de inputs locales ('YYYY-MM-DDTHH:MM'). */
export function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00');
  return new Date(s);
}

export const fmtDate = (s) => (s ? parseDate(s).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (s) =>
  s ? parseDate(s).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtTime = (s) => (s ? parseDate(s).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '');

export function timeAgo(s) {
  if (!s) return '—';
  const diff = (Date.now() - parseDate(s).getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`;
  return fmtDate(s);
}

export const fmtPhone = (p) => (p ? `+${p}` : '');

export const LEAD_STATUS = {
  nuevo: 'Nuevo', contactado: 'Contactado', calificado: 'Calificado', no_calificado: 'No calificado', cliente: 'Cliente', perdido: 'Perdido',
};
export const STAGES = [
  ['prospecto', 'Prospecto'], ['contactado', 'Contactado'], ['demo', 'Demo'], ['propuesta', 'Propuesta'],
  ['negociacion', 'Negociación'], ['ganado', 'Ganado'], ['perdido', 'Perdido'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const QUOTE_STATUS = { borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', vencida: 'Vencida' };
export const ACTIVITY_TYPES = {
  llamada: '📞 Llamada', whatsapp: '💬 WhatsApp', email: '✉️ Email', reunion: '🤝 Reunión', demo: '🖥️ Demo', tarea: '✅ Tarea', nota: '📝 Nota',
};
export const SOURCES = ['WhatsApp', 'Sitio web', 'Facebook', 'Google Ads', 'Referido', 'Llamada entrante', 'Expo / evento', 'Prospección', 'Importación'];
export const BILLING = { unico: 'Pago único', mensual: 'Mensual', anual: 'Anual' };

/** Valor para <input type="datetime-local"> a N días desde ahora. */
export const localDateTime = (daysAhead = 0, hour = 10) => {
  const d = new Date(Date.now() + daysAhead * 86400000);
  d.setHours(hour, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
