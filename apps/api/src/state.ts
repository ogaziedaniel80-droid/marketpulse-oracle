import crypto from 'node:crypto';
import {
  type MarketRow,
  type ReporterRow,
  type RequestRow,
  type ReportRow,
  type ObservationRow,
  type EvidenceRow,
  type FlagRow,
  type AuditRow,
  type PayoutRow,
  type ApiKeyRow,
  type WebhookRow,
  type AdminActionRow,
  createServiceContainer,
  type ServiceContainer,
} from '@marketpulse/shared';

export interface OtpSession {
  phoneHash: string;
  phoneSalt: string;
  countryCode: string;
  otp: string;
  expiresAt: Date;
  verified: boolean;
}

export interface ReporterSession {
  token: string;
  reporterId: string;
  walletAddress: string;
  createdAt: Date;
  expiresAt: Date;
}

export class ApiState {
  public services: ServiceContainer;
  public markets = new Map<string, MarketRow>();
  public reporters = new Map<string, ReporterRow>(); // key: id or walletAddress
  public requests = new Map<string, RequestRow>();
  public reports = new Map<string, ReportRow[]>(); // key: requestId
  public observations = new Map<string, ObservationRow>(); // key: requestId
  public evidence = new Map<string, EvidenceRow>(); // key: evidenceHash
  public flags: FlagRow[] = [];
  public audits: AuditRow[] = [];
  public payouts = new Map<string, PayoutRow[]>(); // key: reporterAddress
  public apiKeys = new Map<string, ApiKeyRow>();
  public webhooks: WebhookRow[] = [];
  public adminActions: AdminActionRow[] = [];

  public otpSessions = new Map<string, OtpSession>(); // key: phoneHash
  public reporterSessions = new Map<string, ReporterSession>(); // key: sessionToken
  public rateLimitHits = new Map<string, { count: number; resetAt: number }>();

  public adminKey = process.env.ADMIN_KEY || 'marketpulse_admin_secret_key_123';

  constructor(services?: Partial<ServiceContainer>) {
    this.services = createServiceContainer(services);
    this.seedDefaults();
  }

  public seedDefaults(): void {
    // Seed markets
    const defaultMarkets: MarketRow[] = [
      {
        id: 'ng-lagos-mile12',
        name: 'Mile 12 Market',
        city: 'Lagos',
        country_code: 'NG',
        geohash: 's14b3k9x',
        metadata: { category: 'wholesale_food', primary_staples: ['RICE50', 'TOMATO', 'GARRI'] },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'ng-abuja-wuse',
        name: 'Wuse Market',
        city: 'Abuja',
        country_code: 'NG',
        geohash: 's1rc1m98',
        metadata: { category: 'retail_food', primary_staples: ['RICE50', 'MAIZE', 'TOMATO'] },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'ng-ibadan-bodija',
        name: 'Bodija Market',
        city: 'Ibadan',
        country_code: 'NG',
        geohash: 's11f4r12',
        metadata: { category: 'wholesale_produce', primary_staples: ['TOMATO', 'GARRI', 'MAIZE'] },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'ng-kano-dawanau',
        name: 'Dawanau Grain Market',
        city: 'Kano',
        country_code: 'NG',
        geohash: 's1t4z801',
        metadata: { category: 'grain_hub', primary_staples: ['RICE50', 'MAIZE', 'GARRI'] },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    for (const m of defaultMarkets) {
      this.markets.set(m.id, m);
    }

    // Seed default standard API Key for buyers
    const defaultRawKey = 'mp_live_buyer_key_default123';
    const keyHash = crypto.createHash('sha256').update(defaultRawKey).digest('hex');
    this.apiKeys.set(keyHash, {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Default Buyer Key',
      key_hash: keyHash,
      key_prefix: 'mp_live_',
      tier: 'standard',
      scopes: [
        'read:observations',
        'read:markets',
        'read:datatypes',
        'write:requests',
        'write:webhooks',
      ],
      rate_limit_per_min: 60,
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00Z'),
    });

    // Seed sample finalized observation matching README §19
    const sampleObs: ObservationRow = {
      request_id: '12345',
      data_type: 'RICE50',
      geohash: 's14b3k9x',
      market_id: 'ng-lagos-mile12',
      value: '8250000',
      decimals: 2,
      currency: 'NGN',
      confidence_bps: 8700,
      n_reports: 9,
      challenge_status: 'closed',
      evidence_bundle_url: 'https://storage.marketpulse.local/bundle/12345',
      finalised_at: new Date('2026-01-15T09:42:11Z'),
      created_at: new Date('2026-01-15T09:42:11Z'),
    };
    this.observations.set('12345', sampleObs);

    // Seed sample request
    const sampleReq: RequestRow = {
      id: '12345',
      requester: 'GBUYER000000000000000000000000000000000000000000000000',
      data_type: 'RICE50',
      geohash: 's14b3k9x',
      bounty: '50000000', // 5 USDC
      token: 'CUSDC0000000000000000000000000000000000000000000000000',
      min_stake: '2500000', // 0.25 USDC
      tolerance_bps: 800,
      commit_deadline: new Date('2026-01-15T08:00:00Z'),
      reveal_deadline: new Date('2026-01-15T09:00:00Z'),
      challenge_window: '3600',
      min_reports: 5,
      max_reports: 15,
      status: 'finalised',
      created_ledger: '100000',
      created_at: new Date('2026-01-15T07:00:00Z'),
      updated_at: new Date('2026-01-15T09:42:11Z'),
    };
    this.requests.set('12345', sampleReq);
  }

  public hashPhone(phone: string, salt: string): string {
    return crypto.createHash('sha256').update(`${salt}:${phone.trim()}`).digest('hex');
  }

  public logAdminAction(
    adminAddress: string,
    action: AdminActionRow['action'],
    targetId: string,
    details: Record<string, unknown> = {},
  ): AdminActionRow {
    const entry: AdminActionRow = {
      id: crypto.randomUUID(),
      admin_address: adminAddress,
      action,
      target_id: targetId,
      details,
      created_at: new Date(),
    };
    this.adminActions.push(entry);
    return entry;
  }
}
