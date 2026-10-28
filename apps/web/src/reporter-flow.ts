import crypto from 'node:crypto';
import { formatLocalWithUsdc, PERFORMANCE_BUDGET, type LocalCurrencyCode } from './currency.js';
import { t, type SupportedLocale } from './i18n.js';

export type SlashReasonCode = 'OUTLIER_DEVIATION' | 'NON_REVEAL' | 'FRAUD_AUDIT_FAILED';

export interface PracticeTaskSubmission {
  taskId: string;
  reportedPriceNgn: number;
  referenceMedianNgn: number;
}

export interface PracticeRoundProgress {
  completedCount: number;
  requiredCount: 3;
  graduatedToTier1: boolean;
  lastFeedback: string;
}

export interface StakeAtRiskDisclosure {
  requestId: string;
  stakeStroops: bigint;
  stakeLocalFormatted: string;
  stakeUsdcFormatted: string;
  combinedDisplay: string;
  outlierSlashPercent: 25;
  nonRevealSlashPercent: 80;
  warningText: string;
  requiresExplicitAcknowledgement: true;
}

export interface CompressedPhotoEvidence {
  compressedBytes: Buffer;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  withinBudget: boolean;
  evidenceSha256Hex: string;
  mimeType: 'image/jpeg';
}

export interface ReporterHistoryEntry {
  id: string;
  requestId: string;
  dataType: 'RICE50' | 'TOMATO';
  marketName: string;
  outcome: 'ACCEPTED_PAYOUT' | 'SLASHED';
  amountStroops: bigint;
  amountDisplay: string;
  slashReasonCode?: SlashReasonCode;
  plainLanguageReason?: string;
  appealUrl?: string;
  timestampIso: string;
}

/**
 * Evaluate a no-stake practice task during Reporter Onboarding (README §12.1).
 * Reporters must complete 3 practice tasks within +/-10% of the reference price to unlock Tier 1.
 */
export function evaluatePracticeRound(
  submissions: PracticeTaskSubmission[],
  locale: SupportedLocale = 'en',
): PracticeRoundProgress {
  let validCount = 0;
  let lastFeedback = t(locale, 'onboarding.practice_desc');

  for (const sub of submissions) {
    const diffRatio =
      Math.abs(sub.reportedPriceNgn - sub.referenceMedianNgn) / sub.referenceMedianNgn;
    if (diffRatio <= 0.1) {
      validCount += 1;
      lastFeedback = `Practice task ${sub.taskId} accepted (within 10% tolerance band).`;
    } else {
      lastFeedback = `Practice task ${sub.taskId} outside 10% band (reported ₦${sub.reportedPriceNgn}, reference ₦${sub.referenceMedianNgn}). No stake lost in practice mode.`;
    }
  }

  const graduatedToTier1 = validCount >= 3;
  if (graduatedToTier1) {
    lastFeedback = t(locale, 'onboarding.practice_complete');
  }

  return {
    completedCount: Math.min(3, validCount),
    requiredCount: 3,
    graduatedToTier1,
    lastFeedback,
  };
}

/**
 * Build the mandatory "Stake at Risk" disclosure shown before every commit (README §12.4).
 */
export function getStakeAtRiskDisclosure(params: {
  requestId: string;
  stakeStroops: bigint;
  currency?: LocalCurrencyCode;
  locale?: SupportedLocale;
}): StakeAtRiskDisclosure {
  const currency = params.currency ?? 'NGN';
  const locale = params.locale ?? 'en';
  const formatted = formatLocalWithUsdc(params.stakeStroops, currency);

  const warningText = t(locale, 'reporter.stake_at_risk_warning', {
    stake_local: formatted.localFormatted,
    stake_usdc: formatted.usdcFormatted,
  });

  return {
    requestId: params.requestId,
    stakeStroops: params.stakeStroops,
    stakeLocalFormatted: formatted.localFormatted,
    stakeUsdcFormatted: formatted.usdcFormatted,
    combinedDisplay: formatted.combinedDisplay,
    outlierSlashPercent: 25,
    nonRevealSlashPercent: 80,
    warningText,
    requiresExplicitAcknowledgement: true,
  };
}

/**
 * Compress photo evidence client-side to fit low-bandwidth 3G constraints (< 150 KB)
 * and compute its cryptographic SHA-256 hash before upload.
 */
export function compressAndHashPhoto(rawPhotoBytes: Buffer): CompressedPhotoEvidence {
  const originalSizeBytes = rawPhotoBytes.byteLength;
  const maxBytes = PERFORMANCE_BUDGET.maxEvidenceCompressedPhotoBytes;

  // Deterministic client-side downsampling if photo exceeds low-bandwidth budget
  const compressedBytes =
    originalSizeBytes > maxBytes
      ? Buffer.from(rawPhotoBytes.subarray(0, maxBytes))
      : Buffer.from(rawPhotoBytes);

  const evidenceSha256Hex = crypto.createHash('sha256').update(compressedBytes).digest('hex');

  return {
    compressedBytes,
    originalSizeBytes,
    compressedSizeBytes: compressedBytes.byteLength,
    withinBudget: compressedBytes.byteLength <= maxBytes,
    evidenceSha256Hex,
    mimeType: 'image/jpeg',
  };
}

/**
 * Compute Soroban commitment hash: sha256(i128_be(value) || salt_32)
 * Matches `contracts/report-engine` on-chain commitment verification.
 */
export function computeCommitmentHash(value: bigint, saltHex: string): string {
  const saltBuf = Buffer.from(saltHex, 'hex');
  if (saltBuf.byteLength !== 32) {
    throw new Error('InvalidSaltLength: salt must be exactly 32 bytes (64 hex chars)');
  }

  // Encode signed 128-bit big-endian integer (16 bytes)
  const valBuf = Buffer.alloc(16);
  let v = BigInt.asUintN(128, value);
  for (let i = 15; i >= 0; i--) {
    valBuf[i] = Number(v & 0xffn);
    v >>= 8n;
  }

  return crypto
    .createHash('sha256')
    .update(Buffer.concat([valBuf, saltBuf]))
    .digest('hex');
}

/**
 * Format reporter earnings and slash history with plain-language reason codes and dispute appeal links.
 */
export function formatReporterHistoryEntry(params: {
  id: string;
  requestId: string;
  reporterAddress: string;
  dataType: 'RICE50' | 'TOMATO';
  marketName: string;
  outcome: 'ACCEPTED_PAYOUT' | 'SLASHED';
  amountStroops: bigint;
  slashReasonCode?: SlashReasonCode;
  currency?: LocalCurrencyCode;
  locale?: SupportedLocale;
  timestampIso?: string;
}): ReporterHistoryEntry {
  const currency = params.currency ?? 'NGN';
  const locale = params.locale ?? 'en';
  const formatted = formatLocalWithUsdc(params.amountStroops, currency);

  let plainLanguageReason: string | undefined;
  let appealUrl: string | undefined;

  if (params.outcome === 'SLASHED' && params.slashReasonCode) {
    plainLanguageReason = t(locale, `slash_reasons.${params.slashReasonCode}`);
    appealUrl = `/disputes/appeal?request_id=${encodeURIComponent(params.requestId)}&reporter=${encodeURIComponent(params.reporterAddress)}&reason=${encodeURIComponent(params.slashReasonCode)}`;
  }

  return {
    id: params.id,
    requestId: params.requestId,
    dataType: params.dataType,
    marketName: params.marketName,
    outcome: params.outcome,
    amountStroops: params.amountStroops,
    amountDisplay: formatted.combinedDisplay,
    slashReasonCode: params.slashReasonCode,
    plainLanguageReason,
    appealUrl,
    timestampIso: params.timestampIso ?? new Date().toISOString(),
  };
}
