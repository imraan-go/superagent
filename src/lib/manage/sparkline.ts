/**
 * In-memory time series for the Overview sparklines. Pure and immutable so it
 * is trivially testable and safe to hold in React state.
 */
export interface Sample {
  t: number;
  v: number;
}

export const SPARK_WINDOW_MS = 30 * 60 * 1000;

/** Appends a sample and drops anything older than `windowMs` (relative to the new sample). */
export function pushSample(
  series: readonly Sample[],
  sample: Sample,
  windowMs: number = SPARK_WINDOW_MS,
): Sample[] {
  const cutoff = sample.t - windowMs;
  const last = series[series.length - 1];
  // Out-of-order or duplicate timestamps would draw a backwards line.
  if (last && sample.t <= last.t) return series.filter((s) => s.t >= cutoff);
  return [...series.filter((s) => s.t >= cutoff), sample];
}

/**
 * SVG polyline points for a series. `max` pins the y-scale (100 for percents)
 * so a flat 3% CPU does not look like a spike.
 */
export function sparkPoints(
  series: readonly Sample[],
  width: number,
  height: number,
  opts: { max?: number; windowMs?: number } = {},
): string {
  const last = series[series.length - 1];
  if (!last) return "";
  const windowMs = opts.windowMs ?? SPARK_WINDOW_MS;
  const start = last.t - windowMs;
  const max = opts.max ?? Math.max(1, ...series.map((s) => s.v));
  return series
    .map((s) => {
      const x = ((s.t - start) / windowMs) * width;
      const y = height - Math.min(1, Math.max(0, s.v / max)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
