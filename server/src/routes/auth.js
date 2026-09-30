import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signToken, requireAuth, requireAdmin } from '../auth.js';
import { HttpError, asyncHandler } from '../utils.js';

export default function authRoutes(db) {
  const r = Router();

  r.post('/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').toLowerCase().trim());
    if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }));

  r.get('/auth/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id);
    if (!user) throw new HttpError(401, 'Usuario no encontrado');
    res.json(user);
  });

  r.post('/auth/password', requireAuth, (req, res) => {
    const { current, next } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(current || ''), user.password_hash)) throw new HttpError(400, 'Contraseña actual incorrecta');
    if (!next || String(next).length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 10), user.id);
    res.json({ ok: true });
  });

  // ---- Usuarios (equipo de ventas) ----
  r.get('/users', requireAuth, (_req, res) => {
    res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY name').all());
  });

  r.post('/users', requireAuth, requireAdmin, (req, res) => {
    const { name, email, password, role = 'ventas' } = req.body || {};
    if (!name || !email || !password) throw new HttpError(400, 'Nombre, correo y contraseña son obligatorios');
    if (String(password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    try {
      const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, String(email).toLowerCase().trim(), bcrypt.hashSync(String(password), 10), role === 'admin' ? 'admin' : 'ventas');
      res.status(201).json(db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ya existe un usuario con ese correo');
      throw e;
    }
  });

  r.put('/users/:id', requireAuth, requireAdmin, (req, res) => {
    const { name, role, active, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    if (u.id === req.user.id && (active === false || active === 0 || role === 'ventas')) {
      throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador');
    }
    db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
      name ?? u.name,
      role ?? u.role,
      active === undefined ? u.active : active ? 1 : 0,
      u.id,
    );
    if (password) {
      if (String(password).length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), u.id);
    }
    res.json(db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(u.id));
  });

  return r;
}
