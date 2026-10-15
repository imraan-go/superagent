import "server-only";
import { logger } from "@/server/lib/logger";
import { tickPanelSchedules } from "./schedules";

/**
 * In-process scheduler for panel-native scheduled prompts (ADR-04: a single
 * panel instance, so one timer is the whole cluster). Started once from
 * `src/instrumentation.ts`; the globalThis guard survives dev HMR.
 */
const TICK_MS = 30_000;
const g = globalThis as unknown as { __fdScheduler?: NodeJS.Timeout; __fdSchedulerBusy?: boolean };

export function startScheduler(): void {
  if (g.__fdScheduler) return;
  const tick = async () => {
    if (g.__fdSchedulerBusy) return;
    g.__fdSchedulerBusy = true;
    try {
      await tickPanelSchedules();
    } catch (err) {
      logger.warn("scheduler", { msg: "tick failed", detail: String(err) });
    } finally {
      g.__fdSchedulerBusy = false;
    }
  };
  g.__fdScheduler = setInterval(() => void tick(), TICK_MS);
  g.__fdScheduler.unref?.();
  logger.info("scheduler", { msg: "started", everyMs: TICK_MS });
}
