export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Normaliza un teléfono a solo dígitos con lada de país (formato que usa WhatsApp: 5215512345678). */
export function normalizePhone(raw, defaultCountry = process.env.DEFAULT_COUNTRY_CODE || '52') {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = defaultCountry + digits;
  return digits;
}

/** Devuelve un objeto solo con las llaves permitidas que vengan definidas en `body`. */
export function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
  return out;
}

export function buildUpdate(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return null;
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  return { sql: `UPDATE ${table} SET ${sets} WHERE id = @__id`, params: { ...data, __id: id } };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
