import jwt from 'jsonwebtoken';
import { HttpError } from './utils.js';

const secret = () => process.env.JWT_SECRET || 'dev-secret-cambia-esto';

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, secret(), { expiresIn: '7d' });
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'No autenticado'));
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    next(new HttpError(401, 'Sesión inválida o expirada'));
  }
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Solo administradores'));
  next();
}
