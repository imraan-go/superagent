"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { Button, LiveGlyph } from "@/components/ui";
import styles from "./login.module.css";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "Sign-in failed.");
        setPending(false);
        return;
      }

      // The splash plays once per session; mark this login as fresh.
      sessionStorage.setItem("fd.splash", "pending");
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Could not reach the panel. Is it still running?");
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.brand}>
        <LiveGlyph state={pending ? "thinking" : "idle"} size={48} label="" />
        <h1 className={styles.title}>Flight Deck</h1>
        <span className={styles.subtitle}>Owner access</span>
      </div>

      <form className={styles.form} onSubmit={onSubmit}>
        {error && (
          <div className={styles.error} role="alert">
            <WarningOctagon size={16} weight="duotone" aria-hidden />
            <span>{error}</span>
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
            autoComplete="current-password"
            required
            disabled={pending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          {pending ? "Verifying" : "Sign in"}
        </Button>
      </form>

      <p className={styles.footnote}>
        Single-owner panel. Registration is disabled.
      </p>
    </div>
  );
}
