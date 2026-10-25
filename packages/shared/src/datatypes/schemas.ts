import { z } from 'zod';

export const LaunchDataTypeCodeSchema = z.enum([
  'RICE50',
  'GARRI',
  'MAIZE',
  'TOMATO',
  'FUEL_PMS',
  'FUEL_DSL',
]);

export const PlannedDataTypeCodeSchema = z.enum([
  'POWER',
  'ROAD',
  'LPG',
  'FX_PARALLEL',
  'CHECKPOINT',
]);

export const DataTypeCodeSchema = z.union([LaunchDataTypeCodeSchema, PlannedDataTypeCodeSchema]);

export const CurrencyCodeSchema = z.enum(['NGN', 'GHS', 'XOF', 'GMD', 'USD']);

export const DataTypeSpecSchema = z.object({
  code: DataTypeCodeSchema,
  name: z.string().min(1),
  category: z.enum(['staples', 'produce', 'energy', 'utilities', 'logistics', 'fx']),
  enabled: z.boolean(),
  status: z.enum(['active', 'planned']),
  unit: z.string().min(1),
  grade: z.string().min(1),
  locationGranularity: z.string().min(1),
  currency: CurrencyCodeSchema,
  decimals: z.number().int().min(0).max(18),
  defaultToleranceBps: z.number().int().min(0).max(5000), // 0% (exact match for categorical) to 50%
  evidenceRule: z.string().min(1),
  safetyReviewRequired: z.boolean().optional(),
  legalReviewRequired: z.boolean().optional(),
});

export const GeohashSchema = z
  .string()
  .min(6, 'Geohash must be at least 6 characters for market granularity')
  .max(8, 'Geohash must not exceed 8 characters to prevent identifying private stalls')
  .regex(/^[0-9bcdefghjkmnpqrstuvwxyz]+$/, 'Invalid geohash format');

export const RequestParamsSchema = z
  .object({
    dataType: DataTypeCodeSchema,
    geohash: GeohashSchema,
    bounty: z
      .union([z.bigint(), z.string().regex(/^\d+$/)])
      .refine((val) => BigInt(val) >= 3_000_000n, {
        message: 'Bounty must be at least 3 USDC (3_000_000 minor units)',
      }),
    token: z.string().min(10, 'Token address must be valid Soroban address'),
    minStake: z
      .union([z.bigint(), z.string().regex(/^\d+$/)])
      .refine((val) => BigInt(val) >= 250_000n, {
        message: 'Minimum stake must be at least 0.25 USDC (250_000 minor units)',
      }),
    toleranceBps: z.number().int().min(100).max(3000), // 1% to 30%
    commitDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    challengeWindow: z.number().int().min(3600), // at least 1 hour
    minReports: z.number().int().min(3).max(15),
    maxReports: z.number().int().min(3).max(15),
  })
  .refine((data) => data.commitDeadline < data.revealDeadline, {
    message: 'commitDeadline must be earlier than revealDeadline',
    path: ['revealDeadline'],
  })
  .refine((data) => data.minReports <= data.maxReports, {
    message: 'minReports must be less than or equal to maxReports',
    path: ['maxReports'],
  });

export const ReportValueSchema = z.object({
  value: z.union([z.bigint(), z.string().regex(/^\d+$/)]),
  salt: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Salt must be 32-byte hex string'),
  evidenceHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Evidence hash must be 32-byte hex string'),
});

export const ObservationSchema = z.object({
  requestId: z.union([z.bigint(), z.string().regex(/^\d+$/)]),
  dataType: DataTypeCodeSchema,
  geohash: GeohashSchema,
  value: z.union([z.bigint(), z.string().regex(/^\d+$/)]),
  confidenceBps: z.number().int().min(0).max(10000),
  nReports: z.number().int().min(1),
  finalisedAt: z.number().int().positive(),
});
