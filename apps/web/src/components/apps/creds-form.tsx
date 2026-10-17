'use client';

import { Button } from '@/components/ui';
import { useApps } from './apps-context';
import styles from './apps.module.css';

/** API-key / bearer / basic apps: values go straight to Composio; this panel never stores or echoes them. */
export function CredsForm() {
  const { creds, setCreds, submitCreds, connecting } = useApps();
  if (!creds) return null;
  return (
    <form
      className={styles.creds}
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        submitCreds();
      }}
    >
      <p className={styles.itemName}>
        Connect {creds.name} ({creds.scheme.replace(/_/g, ' ').toLowerCase()})
      </p>
      <p className={styles.muted}>
        These values go straight to Composio. This panel does not store, log or display them.
      </p>
      {creds.fields.map((f) => (
        <input
          key={f.name}
          className={styles.input}
          type={f.secret ? 'password' : 'text'}
          autoComplete="off"
          placeholder={f.displayName + (f.required ? '' : ' (optional)')}
          aria-label={f.displayName}
          required={f.required}
          value={creds.values[f.name] ?? ''}
          onChange={(e) => setCreds({ ...creds, values: { ...creds.values, [f.name]: e.target.value } })}
        />
      ))}
      <div className={styles.credsActions}>
        <Button size="sm" variant="primary" type="submit" loading={connecting === creds.toolkit}>
          Connect
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCreds(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
