'use client';

import { useQuery } from '@tanstack/react-query';
import { SettingRow, SettingSection, SkeletonText } from '@/components/ui';
import { api as apiClient } from '@/lib/api';
import { settingsFetch } from '@/hooks/use-settings';
import { cn } from '@/lib/cn';
import { InlineError } from '../controls';
import styles from '../settings-tabs.module.css';
import type { ToolsView } from './agent-tab';
import { TOOLS_KEY } from './agent-tab';

const CAPABILITY_LABEL: Record<string, string> = {
  database: 'Database',
  gateway: 'Vercel AI Gateway (models)',
  budget: 'Budget caps',
  storage: 'Artifact storage (S3/MinIO)',
  temporal: 'Temporal (durable runs)',
  e2b_code: 'E2B cloud workspace',
  e2b_browser: 'E2B cloud browser',
  composio: 'Composio (connected apps)',
};

/**
 * Settings → Models: read-only. Every model call goes through the Vercel AI Gateway, and the
 * installation's allowlist (AI_MODEL_ALLOWLIST) decides which models a chat may pick.
 */
export function ModelsTab() {
  const models = useQuery({ queryKey: ['models'], queryFn: apiClient.listModels, staleTime: 60_000 });
  const setup = useQuery({ queryKey: TOOLS_KEY, queryFn: () => settingsFetch<ToolsView>('/api/tools') });

  return (
    <div className={styles.stack}>
      <SettingSection title="Models">
        <p className={cn(styles.muted, styles.pad)}>
          Models run through the Vercel AI Gateway. The server&apos;s allowlist decides which ones chats can use; each
          chat keeps the model it was started with.
        </p>
        {models.isPending && <SkeletonText lines={3} />}
        <InlineError error={models.error} />
        {models.data?.models.map((m) => (
          <SettingRow key={m.id} label={m.label} description={<span className={styles.mono}>{m.id}</span>}>
            <span className={cn(styles.badge, m.id === models.data.defaultModel && styles.badgeLock)}>
              {m.id === models.data.defaultModel ? 'default' : (m.tier ?? 'enabled')}
            </span>
          </SettingRow>
        ))}
      </SettingSection>

      <SettingSection title="Installation">
        <p className={cn(styles.muted, styles.pad)}>
          What this server is configured for. Keys are set on the server and never shown here.
        </p>
        {setup.isPending && <SkeletonText lines={4} />}
        <InlineError error={setup.error} />
        {setup.data &&
          Object.entries(setup.data.capabilities).map(([k, v]) => (
            <SettingRow
              key={k}
              label={CAPABILITY_LABEL[k] ?? k}
              description={v.configured ? undefined : `Missing: ${v.missing.join(', ')}`}
            >
              <span className={cn(v.configured ? styles.ok : styles.error)}>
                {v.configured ? 'Ready' : 'Not set up'}
              </span>
            </SettingRow>
          ))}
      </SettingSection>
    </div>
  );
}
