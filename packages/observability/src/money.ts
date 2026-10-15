/**
 * Money is represented as integer nano-USD (1e-9 USD) in bigint so that per-token prices such as
 * "0.000000005" are exact. Never use floating point for budget arithmetic.
 */
export const NANOS_PER_USD = 1_000_000_000n;

export function usdToNanos(usd: string): bigint {
  const s = usd.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USD decimal: ${usd}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 9 && /[1-9]/.test(frac.slice(9))) throw new Error(`USD amount has sub-nano precision: ${usd}`);
  return BigInt(whole!) * NANOS_PER_USD + BigInt((frac + '000000000').slice(0, 9));
}

export function nanosToUsd(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / NANOS_PER_USD;
  const frac = (abs % NANOS_PER_USD).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** price-per-unit (decimal string USD) * quantity, rounded up to the next nano. */
export function priceTimes(pricePerUnitUsd: string, quantity: number | bigint): bigint {
  const s = pricePerUnitUsd.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid price: ${pricePerUnitUsd}`);
  const [whole, frac = ''] = s.split('.');
  const scale = 10n ** BigInt(frac.length);
  const numerator = (BigInt(whole!) * scale + BigInt(frac || '0')) * BigInt(quantity) * NANOS_PER_USD;
  return (numerator + scale - 1n) / scale;
}

export type CostStatus = 'measured' | 'estimated' | 'unknown';
