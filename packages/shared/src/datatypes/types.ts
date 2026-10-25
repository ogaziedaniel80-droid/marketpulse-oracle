export type LaunchDataTypeCode = 'RICE50' | 'GARRI' | 'MAIZE' | 'TOMATO' | 'FUEL_PMS' | 'FUEL_DSL';

export type PlannedDataTypeCode = 'POWER' | 'ROAD' | 'LPG' | 'FX_PARALLEL' | 'CHECKPOINT';

export type DataTypeCode = LaunchDataTypeCode | PlannedDataTypeCode;

export type CurrencyCode = 'NGN' | 'GHS' | 'XOF' | 'GMD' | 'USD';

export interface DataTypeSpec {
  code: DataTypeCode;
  name: string;
  category: 'staples' | 'produce' | 'energy' | 'utilities' | 'logistics' | 'fx';
  enabled: boolean;
  status: 'active' | 'planned';
  unit: string;
  grade: string;
  locationGranularity: string; // e.g., 'market-level geohash (6-8 chars)'
  currency: CurrencyCode;
  decimals: number;
  defaultToleranceBps: number; // e.g. 800 = 8.00%
  evidenceRule: string;
  safetyReviewRequired?: boolean;
  legalReviewRequired?: boolean;
}

export interface RequestParamsInput {
  dataType: string;
  geohash: string; // 6-8 chars
  bounty: string | bigint; // minor units of USDC
  token: string; // SAC address
  minStake: string | bigint;
  toleranceBps: number;
  commitDeadline: number; // unix timestamp seconds
  revealDeadline: number;
  challengeWindow: number;
  minReports: number;
  maxReports: number;
}
