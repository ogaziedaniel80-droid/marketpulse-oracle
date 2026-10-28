import crypto from 'node:crypto';
import { ALL_DATA_TYPES, RequestParamsSchema } from '@marketpulse/shared';

export interface BuyerCreateRequestInput {
  dataType: string;
  geohash: string;
  bounty: bigint | string;
  token: string;
  minStake: bigint | string;
  toleranceBps: number;
  commitDeadline: number;
  revealDeadline: number;
  challengeWindow: number;
  minReports: number;
  maxReports: number;
}

export interface MapLibreMarketMarker {
  id: string;
  marketName: string;
  city: string;
  geohash: string;
  coordinates: [number, number]; // [lon, lat]
  latestPriceNgn: number;
  confidenceBps: number;
  nReports: number;
}

export interface MapLibreConfig {
  styleUrl: string;
  center: [number, number]; // [lon, lat] Abuja default
  zoom: number;
  markers: MapLibreMarketMarker[];
}

export interface RechartsTrendPoint {
  dateLabel: string;
  timestampSec: number;
  medianPriceNgn: number;
  lowerBandNgn: number;
  upperBandNgn: number;
  confidenceBps: number;
}

export interface BuyerApiKey {
  id: string;
  label: string;
  keyPrefix: string;
  secretKey?: string;
  createdAtIso: string;
  revoked: boolean;
}

export interface BuyerWebhookSubscription {
  id: string;
  targetUrl: string;
  dataTypes: string[];
  hmacSecretPreview: string;
  active: boolean;
  createdAtIso: string;
}

/**
 * Validate Buyer request parameters using the shared Zod schema (`RequestParamsSchema`)
 * and enforce that planned second-wave data types (POWER, ROAD, LPG, FX_PARALLEL, CHECKPOINT)
 * remain disabled until safety/legal review completes.
 */
export function validateBuyerRequestParams(input: BuyerCreateRequestInput) {
  const parsed = RequestParamsSchema.parse(input);
  const spec = ALL_DATA_TYPES[parsed.dataType];
  if (!spec || !spec.enabled) {
    throw new Error(
      `DisabledDataTypeError: Data type ${parsed.dataType} is currently disabled (${spec?.status ?? 'unknown'})`,
    );
  }
  return parsed;
}

/**
 * Generate MapLibre GL configuration and GeoJSON market observation pins for the Buyer Dashboard.
 */
export function buildMapLibreCoverageConfig(
  customMarkers?: MapLibreMarketMarker[],
): MapLibreConfig {
  const defaultMarkers: MapLibreMarketMarker[] = [
    {
      id: 'mkt_wuse',
      marketName: 'Wuse Market',
      city: 'Abuja',
      geohash: 's14702',
      coordinates: [7.4646, 9.0722],
      latestPriceNgn: 82000,
      confidenceBps: 9400,
      nReports: 5,
    },
    {
      id: 'mkt_garki',
      marketName: 'Garki Model Market',
      city: 'Abuja',
      geohash: 's146cr',
      coordinates: [7.4891, 9.0256],
      latestPriceNgn: 83500,
      confidenceBps: 9100,
      nReports: 5,
    },
    {
      id: 'mkt_utako',
      marketName: 'Utako Ultra Modern Market',
      city: 'Abuja',
      geohash: 's14700',
      coordinates: [7.4418, 9.0614],
      latestPriceNgn: 81500,
      confidenceBps: 8950,
      nReports: 4,
    },
  ];

  return {
    styleUrl: 'https://demotiles.maplibre.org/style.json',
    center: [7.4646, 9.0722],
    zoom: 11,
    markers: customMarkers ?? defaultMarkers,
  };
}

/**
 * Transform finalised oracle observations into Recharts time-series data points with tolerance bands.
 */
export function buildRechartsTrendSeries(
  observations: Array<{
    timestampSec: number;
    medianPriceNgn: number;
    toleranceBps: number;
    confidenceBps: number;
  }>,
): RechartsTrendPoint[] {
  return observations
    .slice()
    .sort((a, b) => a.timestampSec - b.timestampSec)
    .map((obs) => {
      const tolRatio = obs.toleranceBps / 10000;
      const dateLabel = new Date(obs.timestampSec * 1000).toISOString().slice(0, 10);
      return {
        dateLabel,
        timestampSec: obs.timestampSec,
        medianPriceNgn: obs.medianPriceNgn,
        lowerBandNgn: Math.round(obs.medianPriceNgn * (1 - tolRatio)),
        upperBandNgn: Math.round(obs.medianPriceNgn * (1 + tolRatio)),
        confidenceBps: obs.confidenceBps,
      };
    });
}

export class BuyerPortalManager {
  private apiKeys = new Map<string, BuyerApiKey>();
  private webhooks = new Map<string, BuyerWebhookSubscription>();

  public issueApiKey(label: string): BuyerApiKey {
    const id = `key_${crypto.randomBytes(6).toString('hex')}`;
    const rawSecret = `mp_live_${crypto.randomBytes(20).toString('hex')}`;
    const record: BuyerApiKey = {
      id,
      label,
      keyPrefix: `${rawSecret.slice(0, 12)}...`,
      secretKey: rawSecret,
      createdAtIso: new Date().toISOString(),
      revoked: false,
    };
    this.apiKeys.set(id, { ...record, secretKey: undefined });
    return record;
  }

  public revokeApiKey(id: string): BuyerApiKey {
    const key = this.apiKeys.get(id);
    if (!key) throw new Error(`ApiKeyNotFound: ${id}`);
    key.revoked = true;
    return key;
  }

  public listApiKeys(): BuyerApiKey[] {
    return Array.from(this.apiKeys.values());
  }

  public registerWebhook(params: {
    targetUrl: string;
    dataTypes: string[];
  }): BuyerWebhookSubscription {
    if (!params.targetUrl.startsWith('https://') && !params.targetUrl.startsWith('http://localhost')) {
      throw new Error('InvalidWebhookUrl: Webhook must use HTTPS (or localhost in dev)');
    }
    const id = `wh_${crypto.randomBytes(6).toString('hex')}`;
    const hmacSecret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const sub: BuyerWebhookSubscription = {
      id,
      targetUrl: params.targetUrl,
      dataTypes: params.dataTypes,
      hmacSecretPreview: `${hmacSecret.slice(0, 10)}***`,
      active: true,
      createdAtIso: new Date().toISOString(),
    };
    this.webhooks.set(id, sub);
    return sub;
  }

  public listWebhooks(): BuyerWebhookSubscription[] {
    return Array.from(this.webhooks.values());
  }
}
