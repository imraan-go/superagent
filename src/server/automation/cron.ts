/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week), evaluated
 * in **UTC** — the same clock LHOS reports `next_run_utc` in, so panel-native
 * and LHOS schedules read consistently side by side.
 *
 * Supported per field: `*`, `n`, `a-b`, `*\/s`, `a-b/s`, `n/s` and comma lists.
 * Day-of-week accepts 0–7 (0 and 7 are Sunday). As in Vixie cron, when both
 * day-of-month and day-of-week are restricted a day matches if *either* does.
 *
 * Pure module: no server imports, so it is unit-testable and safe anywhere.
 */

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
] as const;

export class CronError extends Error {}

function parseField(raw: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new CronError(`Invalid ${name} field: "${part}"`);
    const [, range = "", stepRaw] = m;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`Invalid step in ${name}`);

    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a!;
      // `n/s` means "from n to the end, every s".
      hi = b ?? (stepRaw === undefined ? a! : max);
    }
    if (lo < min || hi > max || lo > hi) {
      throw new CronError(`${name} out of range (${min}-${max}): "${part}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError("Cron needs exactly 5 fields: m h dom mon dow");

  const [minutes, hours, days, months, weekdaysRaw] = parts.map((p, i) =>
    parseField(p, FIELDS[i]!.min, FIELDS[i]!.max, FIELDS[i]!.name),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];

  const weekdays = new Set([...weekdaysRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.days.has(d.getUTCDate());
  const dow = spec.weekdays.has(d.getUTCDay());
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  if (spec.domRestricted) return dom;
  if (spec.dowRestricted) return dow;
  return true;
}

/** First matching minute strictly after `from`, or null within ~5 years. */
export function nextRun(expr: string | CronSpec, from: Date = new Date()): Date | null {
  const spec = typeof expr === "string" ? parseCron(expr) : expr;
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);

  const limit = from.getTime() + 5 * 366 * 24 * 3600 * 1000;
  while (t.getTime() <= limit) {
    if (!spec.months.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, t)) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}
