export type LocalCurrencyCode = 'NGN' | 'GHS' | 'XOF';

export interface CurrencyRate {
  code: LocalCurrencyCode;
  symbol: string;
  ratePerUsdc: number;
}

export const DEFAULT_FX_RATES: Record<LocalCurrencyCode, CurrencyRate> = {
  NGN: { code: 'NGN', symbol: '₦', ratePerUsdc: 1600 },
  GHS: { code: 'GHS', symbol: 'GH₵', ratePerUsdc: 15.5 },
  XOF: { code: 'XOF', symbol: 'CFA', ratePerUsdc: 610 },
};

/**
 * Low-bandwidth performance budget for mid-range West African Android devices on 3G.
 * Reporter initial JS payload must remain under 120 KB compressed.
 */
export const PERFORMANCE_BUDGET = {
  maxReporterInitialJsBytes: 120 * 1024, // 120 KB
  maxEvidenceCompressedPhotoBytes: 150 * 1024, // 150 KB
  maxTimeToInteractiveMs3G: 3500,
} as const;

/**
 * Format an amount in USDC stroops (7 decimals, 1 USDC = 10_000_000 stroops)
 * into local currency with the USDC equivalent clearly displayed.
 */
export function formatLocalWithUsdc(
  amountStroops: bigint | number,
  currency: LocalCurrencyCode = 'NGN',
): {
  usdcFormatted: string;
  localFormatted: string;
  combinedDisplay: string;
} {
  const stroops = Number(amountStroops);
  const usdcValue = stroops / 10_000_000;
  const fx = DEFAULT_FX_RATES[currency];
  const localValue = Math.round(usdcValue * fx.ratePerUsdc);

  const usdcFormatted = usdcValue.toFixed(2);
  const localFormatted = `${fx.symbol}${localValue.toLocaleString('en-US')} ${fx.code}`;
  const combinedDisplay = `${localFormatted} (~${usdcFormatted} USDC)`;

  return {
    usdcFormatted,
    localFormatted,
    combinedDisplay,
  };
}
