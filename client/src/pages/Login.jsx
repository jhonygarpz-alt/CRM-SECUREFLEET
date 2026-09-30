import { useState } from 'react';
import { api } from '../api.js';
import { useAuth, useBrand, logoUrl } from '../App.jsx';

export default function Login() {
  const { login } = useAuth();
  const brand = useBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      login(r.token, r.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand big login-brand">
          <img className="brand-logo big" src={logoUrl(brand)} alt="" />
          <div><strong>{brand.name}</strong><small>CRM comercial</small></div>
        </div>
        <label>Correo<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label>Contraseña<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block">Entrar</button>
      </form>
    </div>
  );
}
