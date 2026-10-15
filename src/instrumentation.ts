/**
 * Next.js instrumentation hook: `register` runs once per server instance.
 * Starts the in-process scheduler for panel-native scheduled prompts (ADR-04).
 *
 * The import must sit *inside* the `NEXT_RUNTIME === "nodejs"` branch so the
 * bundler drops it from the edge build (the scheduler needs `pg`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PANEL_DISABLE_SCHEDULER !== "1") {
    const { startScheduler } = await import("./server/automation/scheduler");
    startScheduler();
  }
}
