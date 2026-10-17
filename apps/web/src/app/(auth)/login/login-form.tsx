'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WarningOctagon } from '@phosphor-icons/react/dist/ssr';
import { Button, LiveGlyph } from '@/components/ui';
import styles from './login.module.css';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch(mode === 'signin' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'signin' ? { email, password } : { email, password, name: name.trim() || email.split('@')[0] },
        ),
      });

      if (!res.ok) {
        // Better Auth errors are `{ code, message }`.
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? (mode === 'signin' ? 'Sign-in failed.' : 'Sign-up failed.'));
        setPending(false);
        return;
      }

      // The splash plays once per session; mark this login as fresh.
      sessionStorage.setItem('fd.splash', 'pending');
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError('Could not reach the server. Is it still running?');
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.brand}>
        <LiveGlyph state={pending ? 'thinking' : 'idle'} size={48} label="" />
        <h1 className={styles.title}>Superagent</h1>
        <span className={styles.subtitle}>{mode === 'signin' ? 'Sign in' : 'Create account'}</span>
      </div>

      <form className={styles.form} onSubmit={onSubmit}>
        {error && (
          <div className={styles.error} role="alert">
            <WarningOctagon size={16} weight="duotone" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {mode === 'signup' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              Name
            </label>
            <input
              id="name"
              className={styles.input}
              type="text"
              name="name"
              autoComplete="name"
              disabled={pending}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            disabled={pending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            name="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 10 : undefined}
            required
            disabled={pending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          {pending ? 'Verifying' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className={styles.footnote}>
        {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
        <button
          type="button"
          className={styles.switch}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
