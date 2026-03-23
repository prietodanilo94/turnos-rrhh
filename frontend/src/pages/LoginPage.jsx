import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Format RUT visually as user types: 12345678 → 12.345.678
  const handleRutChange = (e) => {
    const raw = e.target.value.replace(/[^0-9kK]/g, '');
    setRut(raw);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(rut, password || '1234');
      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Background grid effect */}
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.04,
        backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
        backgroundSize: '40px 40px', zIndex: 0,
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        background: 'rgba(30, 41, 59, 0.8)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        borderRadius: '16px',
        padding: '48px 40px',
        width: '100%', maxWidth: '420px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>📅</div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800,
            background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TurnosRRHH
          </h1>
          <p style={{ color: '#64748B', fontSize: '13px', marginTop: '6px', marginBottom: 0 }}>
            Sistema de Gestión de Turnos
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* RUT */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              RUT
            </label>
            <input
              id="rut-input"
              type="text"
              value={rut}
              onChange={handleRutChange}
              placeholder="Ej: 12345678K"
              autoComplete="username"
              autoFocus
              required
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0F172A', border: '1px solid #334155',
                borderRadius: '10px', padding: '13px 16px',
                color: '#F1F5F9', fontSize: '16px', outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#6366F1'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
            <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>
              Sin puntos, con o sin guión
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Contraseña
            </label>
            <input
              id="password-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña"
              autoComplete="current-password"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0F172A', border: '1px solid #334155',
                borderRadius: '10px', padding: '13px 16px',
                color: '#F1F5F9', fontSize: '16px', outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#6366F1'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '10px 14px',
              color: '#F87171', fontSize: '13px', marginBottom: '20px',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Submit */}
          <button
            id="login-btn"
            type="submit"
            disabled={loading || !rut}
            style={{
              width: '100%', padding: '14px',
              background: loading ? '#4338CA' : 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              border: 'none', borderRadius: '10px',
              color: '#fff', fontSize: '15px', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: (!rut || loading) ? 0.7 : 1,
              transition: 'all 0.2s', letterSpacing: '0.01em',
            }}
          >
            {loading ? '⏳ Ingresando...' : '→ Ingresar'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px', color: '#334155', fontSize: '12px' }}>
          Pompeyo RRHH · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
