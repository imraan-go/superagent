'use client';

import { useState } from 'react';
import { Button, SettingRow, SettingSection } from '@/components/ui';
import { useSettingsSection } from '@/hooks/use-settings';
import { NOTIFICATION_EVENTS, SOUND_EVENTS } from '@/lib/settings';
import { InlineError, Toggle } from '../controls';
import styles from '../settings-tabs.module.css';

const SOUND_LABEL: Record<(typeof SOUND_EVENTS)[number], string> = {
  send: 'Message sent',
  done: 'Run finished',
  approval: 'Approval needed',
  error: 'Error',
};

const NOTIFY_LABEL: Record<(typeof NOTIFICATION_EVENTS)[number], string> = {
  approval: 'Approval needed',
  runDone: 'Run finished',
  question: 'Agent asked a question',
};

/**
 * Deliberately minimal preview beep. The real sound set lives in the shared
 * `useSound` hook; this only proves the volume setting is audible.
 */
function beep(volume: number): void {
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(volume * 0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
  osc.onended = () => void ctx.close();
}

export function NotificationsTab() {
  const sound = useSettingsSection('sound');
  const notifications = useSettingsSection('notifications');
  const s = sound.value;
  const n = notifications.value;
  const [permission, setPermission] = useState<string>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  return (
    <div className={styles.stack}>
      <SettingSection title="Sound">
        <SettingRow label="Sounds" description="Master switch for every panel sound.">
          <Toggle label="Sounds" checked={s.master} onChange={(master) => void sound.save({ master })} />
        </SettingRow>
        <SettingRow label="Volume" description={`${Math.round(s.volume * 100)}%`}>
          <span className={styles.row}>
            <input
              type="range"
              aria-label="Volume"
              className={styles.range}
              min={0}
              max={1}
              step={0.05}
              defaultValue={s.volume}
              key={s.volume}
              disabled={!s.master}
              onPointerUp={(e) => void sound.save({ volume: Number(e.currentTarget.value) })}
              onKeyUp={(e) => void sound.save({ volume: Number(e.currentTarget.value) })}
            />
            <Button size="sm" variant="ghost" disabled={!s.master} onClick={() => beep(s.volume)}>
              Test sound
            </Button>
          </span>
        </SettingRow>
        {SOUND_EVENTS.map((event) => (
          <SettingRow key={event} label={SOUND_LABEL[event]}>
            <Toggle
              label={`Sound: ${SOUND_LABEL[event]}`}
              checked={s.events[event]}
              disabled={!s.master}
              onChange={(on) => void sound.save({ events: { ...s.events, [event]: on } })}
            />
          </SettingRow>
        ))}
      </SettingSection>

      <SettingSection title="Notifications">
        <SettingRow
          label="Chrome notifications"
          description={
            permission === 'denied'
              ? 'Blocked by the browser — allow notifications for this site first.'
              : permission === 'unsupported'
                ? 'This browser does not support notifications.'
                : 'System notifications while the panel is in the background.'
          }
        >
          <Toggle
            label="Chrome notifications"
            checked={n.chrome}
            disabled={permission === 'unsupported'}
            onChange={async (chrome) => {
              if (chrome && permission === 'default') {
                const result = await Notification.requestPermission();
                setPermission(result);
                if (result !== 'granted') return;
              }
              void notifications.save({ chrome });
            }}
          />
        </SettingRow>
        {NOTIFICATION_EVENTS.map((event) => (
          <SettingRow key={event} label={NOTIFY_LABEL[event]}>
            <Toggle
              label={`Notify: ${NOTIFY_LABEL[event]}`}
              checked={n.events.includes(event)}
              onChange={(on) =>
                void notifications.save({
                  events: on ? [...new Set([...n.events, event])] : n.events.filter((e) => e !== event),
                })
              }
            />
          </SettingRow>
        ))}
      </SettingSection>
      <InlineError error={sound.error ?? notifications.error} />
    </div>
  );
}
