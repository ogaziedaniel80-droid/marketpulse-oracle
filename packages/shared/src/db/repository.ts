import pg from 'pg';
import type {
  MarketRow,
  ReporterRow,
  RequestRow,
  ReportRow,
  ObservationRow,
  EvidenceRow,
  PayoutRow,
  ApiKeyRow,
  WebhookRow,
  AdminActionRow,
  AuditRow,
} from './types.js';

export interface DatabaseRepository {
  query<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  upsertMarket(market: MarketRow): Promise<void>;
  getMarkets(): Promise<MarketRow[]>;
  getMarketById(id: string): Promise<MarketRow | null>;
  upsertReporter(reporter: Partial<ReporterRow> & { id: string; wallet_address: string }): Promise<void>;
  getReporterByWallet(wallet: string): Promise<ReporterRow | null>;
  upsertRequest(req: Partial<RequestRow> & { id: string }): Promise<void>;
  getRequestById(id: string): Promise<RequestRow | null>;
  getOpenRequests(): Promise<RequestRow[]>;
  upsertReport(report: Partial<ReportRow> & { request_id: string; reporter_address: string }): Promise<void>;
  getReportsForRequest(requestId: string): Promise<ReportRow[]>;
  upsertObservation(obs: Partial<ObservationRow> & { request_id: string }): Promise<void>;
  getObservations(filter?: {
    dataType?: string;
    geohash?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ObservationRow[]>;
  getLatestObservation(dataType: string, marketId?: string, geohash?: string): Promise<ObservationRow | null>;
  upsertEvidence(ev: EvidenceRow): Promise<void>;
  getEvidenceByHash(hash: string): Promise<EvidenceRow | null>;
  insertAdminAction(action: AdminActionRow): Promise<void>;
  upsertPayout(payout: PayoutRow): Promise<void>;
  getPayoutsByReporter(reporterAddress: string): Promise<PayoutRow[]>;
  upsertApiKey(key: ApiKeyRow): Promise<void>;
  getApiKeyByKey(key: string): Promise<ApiKeyRow | null>;
  insertWebhook(webhook: WebhookRow): Promise<void>;
  insertAudit(audit: AuditRow): Promise<void>;
}

export class PostgresRepository implements DatabaseRepository {
  private pool: pg.Pool;

  constructor(connectionStringOrPool: string | pg.Pool) {
    if (typeof connectionStringOrPool === 'string') {
      this.pool = new pg.Pool({ connectionString: connectionStringOrPool });
    } else {
      this.pool = connectionStringOrPool;
    }
  }

  async query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertMarket(m: MarketRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO markets (id, name, city, country_code, geohash, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         city = EXCLUDED.city,
         geohash = EXCLUDED.geohash,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [m.id, m.name, m.city, m.country_code, m.geohash, JSON.stringify(m.metadata || {}), m.created_at, m.updated_at],
    );
  }

  async getMarkets(): Promise<MarketRow[]> {
    return this.query<MarketRow>('SELECT * FROM markets ORDER BY city, name ASC');
  }

  async getMarketById(id: string): Promise<MarketRow | null> {
    const rows = await this.query<MarketRow>('SELECT * FROM markets WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async upsertReporter(r: Partial<ReporterRow> & { id: string; wallet_address: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO reporters (id, wallet_address, phone_hash, phone_salt, country_code, reputation_score, tier, status, stake_cap, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         reputation_score = COALESCE(EXCLUDED.reputation_score, reporters.reputation_score),
         tier = COALESCE(EXCLUDED.tier, reporters.tier),
         status = COALESCE(EXCLUDED.status, reporters.status),
         stake_cap = COALESCE(EXCLUDED.stake_cap, reporters.stake_cap),
         updated_at = NOW()`,
      [
        r.id,
        r.wallet_address,
        r.phone_hash || '',
        r.phone_salt || '',
        r.country_code || 'NG',
        r.reputation_score || 5000,
        r.tier || 1,
        r.status || 'active',
        r.stake_cap || '25000000',
        r.created_at || new Date(),
        r.updated_at || new Date(),
      ],
    );
  }

  async getReporterByWallet(wallet: string): Promise<ReporterRow | null> {
    const rows = await this.query<ReporterRow>('SELECT * FROM reporters WHERE wallet_address = $1 OR id = $1', [wallet]);
    return rows[0] || null;
  }

  async upsertRequest(req: Partial<RequestRow> & { id: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO requests (id, requester, data_type, geohash, bounty, token, min_stake, tolerance_bps, commit_deadline, reveal_deadline, challenge_window, min_reports, max_reports, status, created_ledger, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         status = COALESCE(EXCLUDED.status, requests.status),
         updated_at = NOW()`,
      [
        req.id,
        req.requester || '',
        req.data_type || '',
        req.geohash || '',
        req.bounty || '0',
        req.token || 'USDC',
        req.min_stake || '0',
        req.tolerance_bps || 800,
        req.commit_deadline || new Date(),
        req.reveal_deadline || new Date(),
        req.challenge_window || '3600',
        req.min_reports || 3,
        req.max_reports || 15,
        req.status || 'open',
        req.created_ledger || '100000',
        req.created_at || new Date(),
        req.updated_at || new Date(),
      ],
    );
  }

  async getRequestById(id: string): Promise<RequestRow | null> {
    const rows = await this.query<RequestRow>('SELECT * FROM requests WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async getOpenRequests(): Promise<RequestRow[]> {
    return this.query<RequestRow>("SELECT * FROM requests WHERE status = 'open' ORDER BY created_at DESC");
  }

  async upsertReport(rep: Partial<ReportRow> & { request_id: string; reporter_address: string }): Promise<void> {
    const id = rep.id || `${rep.request_id}:${rep.reporter_address}`;
    await this.pool.query(
      `INSERT INTO reports (id, request_id, reporter_address, commitment, value, evidence_hash, stake, weight_bps, revealed, outcome, created_at, revealed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         value = COALESCE(EXCLUDED.value, reports.value),
         evidence_hash = COALESCE(EXCLUDED.evidence_hash, reports.evidence_hash),
         revealed = COALESCE(EXCLUDED.revealed, reports.revealed),
         outcome = COALESCE(EXCLUDED.outcome, reports.outcome),
         revealed_at = COALESCE(EXCLUDED.revealed_at, reports.revealed_at)`,
      [
        id,
        rep.request_id,
        rep.reporter_address,
        rep.commitment || '',
        rep.value || null,
        rep.evidence_hash || null,
        rep.stake || '0',
        rep.weight_bps || 1000,
        rep.revealed ?? false,
        rep.outcome || 'pending',
        rep.created_at || new Date(),
        rep.revealed_at || null,
      ],
    );
  }

  async getReportsForRequest(requestId: string): Promise<ReportRow[]> {
    return this.query<ReportRow>('SELECT * FROM reports WHERE request_id = $1 ORDER BY created_at ASC', [requestId]);
  }

  async upsertObservation(obs: Partial<ObservationRow> & { request_id: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO observations (request_id, data_type, geohash, market_id, value, decimals, currency, confidence_bps, n_reports, challenge_status, evidence_bundle_url, finalised_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (request_id) DO UPDATE SET
         value = EXCLUDED.value,
         confidence_bps = EXCLUDED.confidence_bps,
         challenge_status = EXCLUDED.challenge_status,
         evidence_bundle_url = EXCLUDED.evidence_bundle_url,
         finalised_at = EXCLUDED.finalised_at`,
      [
        obs.request_id,
        obs.data_type || '',
        obs.geohash || '',
        obs.market_id || null,
        obs.value || '0',
        obs.decimals ?? 2,
        obs.currency || 'NGN',
        obs.confidence_bps ?? 9000,
        obs.n_reports ?? 0,
        obs.challenge_status || 'closed',
        obs.evidence_bundle_url || null,
        obs.finalised_at || new Date(),
      ],
    );
  }

  async getObservations(filter: {
    dataType?: string;
    geohash?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<ObservationRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.dataType) {
      params.push(filter.dataType.toUpperCase());
      conditions.push(`UPPER(data_type) = $${params.length}`);
    }
    if (filter.geohash) {
      params.push(`${filter.geohash}%`);
      conditions.push(`geohash LIKE $${params.length}`);
    }
    if (filter.startDate) {
      params.push(filter.startDate);
      conditions.push(`finalised_at >= $${params.length}`);
    }
    if (filter.endDate) {
      params.push(filter.endDate);
      conditions.push(`finalised_at <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 20;
    const offset = filter.offset || 0;
    params.push(limit, offset);

    return this.query<ObservationRow>(
      `SELECT * FROM observations ${whereClause} ORDER BY finalised_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  }

  async getLatestObservation(dataType: string, marketId?: string, geohash?: string): Promise<ObservationRow | null> {
    const conditions = ['UPPER(data_type) = $1'];
    const params: unknown[] = [dataType.toUpperCase()];

    if (marketId) {
      params.push(marketId);
      conditions.push(`market_id = $${params.length}`);
    }
    if (geohash) {
      params.push(`${geohash}%`);
      conditions.push(`geohash LIKE $${params.length}`);
    }

    const rows = await this.query<ObservationRow>(
      `SELECT * FROM observations WHERE ${conditions.join(' AND ')} ORDER BY finalised_at DESC LIMIT 1`,
      params,
    );
    return rows[0] || null;
  }

  async upsertEvidence(ev: EvidenceRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence (id, evidence_hash, storage_key, mime_type, file_size_bytes, exif_stripped_key, check_results, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ev.id,
        ev.evidence_hash,
        ev.storage_key,
        ev.mime_type,
        ev.file_size_bytes,
        ev.exif_stripped_key || null,
        JSON.stringify(ev.check_results || {}),
        ev.created_at,
      ],
    );
  }

  async getEvidenceByHash(hash: string): Promise<EvidenceRow | null> {
    const rows = await this.query<EvidenceRow>('SELECT * FROM evidence WHERE evidence_hash = $1', [hash]);
    return rows[0] || null;
  }

  async insertAdminAction(action: AdminActionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_actions (id, admin_address, action, target_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [action.id, action.admin_address, action.action, action.target_id, JSON.stringify(action.details || {}), action.created_at],
    );
  }

  async upsertPayout(p: PayoutRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO payouts (id, request_id, reporter_address, bounty_reward, stake_returned, slash_bonus, slash_penalty, reason_code, claimed, claimed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET claimed = EXCLUDED.claimed, claimed_at = EXCLUDED.claimed_at`,
      [p.id, p.request_id, p.reporter_address, p.bounty_reward, p.stake_returned, p.slash_bonus, p.slash_penalty, p.reason_code, p.claimed, p.claimed_at || null, p.created_at],
    );
  }

  async getPayoutsByReporter(reporterAddress: string): Promise<PayoutRow[]> {
    return this.query<PayoutRow>('SELECT * FROM payouts WHERE reporter_address = $1 ORDER BY created_at DESC', [reporterAddress]);
  }

  async upsertApiKey(key: ApiKeyRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, tier, scopes, rate_limit_per_min, is_active, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [key.id, key.name, key.key_hash, key.key_prefix, key.tier, key.scopes, key.rate_limit_per_min, key.is_active, key.created_at, key.last_used_at || null],
    );
  }

  async getApiKeyByKey(key: string): Promise<ApiKeyRow | null> {
    const rows = await this.query<ApiKeyRow>('SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true', [key]);
    return rows[0] || null;
  }

  async insertWebhook(w: WebhookRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO webhooks (id, api_key_id, url, event_types, secret, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [w.id, w.api_key_id || null, w.url, w.event_types, w.secret, w.is_active, w.created_at, w.updated_at],
    );
  }

  async insertAudit(a: AuditRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO audits (id, request_id, sample_rate_bps, auditor_address, status, ground_truth_value, notes, completed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [a.id, a.request_id, a.sample_rate_bps, a.auditor_address || null, a.status, a.ground_truth_value || null, a.notes || null, a.completed_at || null, a.created_at],
    );
  }
}
