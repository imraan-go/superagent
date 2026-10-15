'use client';

import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

export default function LoginPage() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await api('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
      else await api('/api/auth/sign-up/email', { method: 'POST', body: { email, password, name: name || email.split('@')[0] } });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center card">
      <h1>{mode === 'in' ? 'Sign in' : 'Create account'}</h1>
      <form onSubmit={submit}>
        {mode === 'up' && (
          <>
            <label htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={10} required />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row spread" style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy}>
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
          <a href="#" onClick={(e) => (e.preventDefault(), setMode(mode === 'in' ? 'up' : 'in'))}>
            {mode === 'in' ? 'Create an account' : 'I have an account'}
          </a>
        </div>
      </form>
    </div>
  );
}
