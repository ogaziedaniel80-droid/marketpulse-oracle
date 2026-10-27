import type { StellarRpcEvent, GetEventsFilter } from './types.js';
import type { MockStellarRpcClient } from './mock-rpc.js';
import type { RequestRow, ReportRow, ObservationRow, PayoutRow } from '@marketpulse/shared';

export interface IndexerStateStore {
  getCursor(): Promise<{ cursor: string; ledger: number } | null>;
  saveCursor(cursor: string, ledger: number): Promise<void>;
  upsertRequest(req: Partial<RequestRow> & { id: string }): Promise<void>;
  upsertReport(
    rep: Partial<ReportRow> & { request_id: string; reporter_address: string },
  ): Promise<void>;
  upsertObservation(obs: Partial<ObservationRow> & { request_id: string }): Promise<void>;
  upsertPayout(
    payout: Partial<PayoutRow> & { request_id: string; reporter_address: string },
  ): Promise<void>;
}

export class InMemoryIndexerStateStore implements IndexerStateStore {
  public cursor: string = '';
  public ledger: number = 0;
  public requests = new Map<string, Partial<RequestRow> & { id: string }>();
  public reports = new Map<
    string,
    Partial<ReportRow> & { request_id: string; reporter_address: string }
  >();
  public observations = new Map<string, Partial<ObservationRow> & { request_id: string }>();
  public payouts = new Map<
    string,
    Partial<PayoutRow> & { request_id: string; reporter_address: string }
  >();

  async getCursor() {
    return this.cursor ? { cursor: this.cursor, ledger: this.ledger } : null;
  }

  async saveCursor(cursor: string, ledger: number) {
    this.cursor = cursor;
    this.ledger = ledger;
  }

  async upsertRequest(req: Partial<RequestRow> & { id: string }) {
    const existing = this.requests.get(req.id) || { id: req.id };
    this.requests.set(req.id, { ...existing, ...req });
  }

  async upsertReport(rep: Partial<ReportRow> & { request_id: string; reporter_address: string }) {
    const key = `${rep.request_id}:${rep.reporter_address}`;
    const existing = this.reports.get(key) || {
      request_id: rep.request_id,
      reporter_address: rep.reporter_address,
    };
    this.reports.set(key, { ...existing, ...rep });
  }

  async upsertObservation(obs: Partial<ObservationRow> & { request_id: string }) {
    const existing = this.observations.get(obs.request_id) || { request_id: obs.request_id };
    this.observations.set(obs.request_id, { ...existing, ...obs });
  }

  async upsertPayout(
    payout: Partial<PayoutRow> & { request_id: string; reporter_address: string },
  ) {
    const key = `${payout.request_id}:${payout.reporter_address}`;
    const existing = this.payouts.get(key) || {
      request_id: payout.request_id,
      reporter_address: payout.reporter_address,
    };
    this.payouts.set(key, { ...existing, ...payout });
  }
}

export class EventIndexer {
  private rpcClient: MockStellarRpcClient;
  private store: IndexerStateStore;
  private startLedger: number;
  public processedEventsCount = 0;
  public lagLedgers = 0;

  constructor(rpcClient: MockStellarRpcClient, store: IndexerStateStore, startLedger = 100000) {
    this.rpcClient = rpcClient;
    this.store = store;
    this.startLedger = startLedger;
  }

  public async pollEvents(
    limit = 100,
  ): Promise<{ processed: number; newCursor: string; lag: number }> {
    const saved = await this.store.getCursor();
    const queryStartLedger = saved ? saved.ledger : this.startLedger;
    const currentCursor = saved ? saved.cursor : undefined;

    // Detect ledger gap beyond RPC retention limits
    if (queryStartLedger < this.rpcClient.oldestLedger) {
      console.warn(
        `[BACKFILL REQUIRED] Ingestion gap detected: cursor ledger ${queryStartLedger} < oldest RPC ledger ${this.rpcClient.oldestLedger}. Triggering backfill strategy.`,
      );
      // Fast forward to oldest available ledger as part of fallback, or run archive sync
    }

    const effectiveStartLedger = Math.max(queryStartLedger, this.rpcClient.oldestLedger);
    const filters: GetEventsFilter[] = [{ type: 'contract' }];

    const res = await this.rpcClient.getEvents(effectiveStartLedger, filters, currentCursor, limit);

    for (const event of res.events) {
      await this.processEvent(event);
      this.processedEventsCount += 1;
    }

    const latestProcessedLedger =
      res.events.length > 0 ? res.events[res.events.length - 1].ledger : effectiveStartLedger;
    const nextCursor = res.cursor || currentCursor || '';

    if (nextCursor) {
      await this.store.saveCursor(nextCursor, latestProcessedLedger);
    }

    this.lagLedgers = Math.max(0, res.latestLedger - latestProcessedLedger);

    return {
      processed: res.events.length,
      newCursor: nextCursor,
      lag: this.lagLedgers,
    };
  }

  /**
   * Idempotent event processor: applies contract events safely regardless of retry count
   */
  public async processEvent(event: StellarRpcEvent): Promise<void> {
    const [action, ...args] = event.topic;

    const val = event.value as Record<string, unknown>;

    switch (action) {
      case 'request_created': {
        await this.store.upsertRequest({
          id: (val.request_id as string) || args[0],
          requester: val.requester as string,
          data_type: val.data_type as string,
          geohash: val.geohash as string,
          bounty: val.bounty as string,
          min_stake: val.min_stake as string,
          min_reports: Number(val.min_reports),
          max_reports: Number(val.max_reports),
          tolerance_bps: Number(val.tolerance_bps),
          status: 'open',
          created_ledger: event.ledger.toString(),
          created_at: new Date(event.ledgerClosedAt),
          updated_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      case 'report_committed': {
        await this.store.upsertReport({
          request_id: (val.request_id as string) || args[0],
          reporter_address: (val.reporter as string) || args[1],
          commitment: val.commitment as string,
          stake: val.stake as string,
          weight_bps: 100,
          revealed: false,
          outcome: 'pending',
          created_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      case 'report_revealed': {
        await this.store.upsertReport({
          request_id: (val.request_id as string) || args[0],
          reporter_address: (val.reporter as string) || args[1],
          value: val.value as string,
          evidence_hash: val.evidence_hash as string,
          revealed: true,
          revealed_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      case 'request_resolved': {
        const reqId = (val.request_id as string) || args[0];
        await this.store.upsertRequest({
          id: reqId,
          status: 'resolving',
          updated_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      case 'observation_written': {
        await this.store.upsertObservation({
          request_id: val.request_id as string,
          data_type: (val.data_type as string) || args[0],
          geohash: (val.geohash as string) || args[1],
          value: val.value as string,
          confidence_bps: Number(val.confidence_bps),
          n_reports: Number(val.n_reports),
          challenge_status: 'closed',
          finalised_at: new Date(event.ledgerClosedAt),
          created_at: new Date(event.ledgerClosedAt),
        });
        // Also update request status to finalised
        await this.store.upsertRequest({
          id: val.request_id as string,
          status: 'finalised',
          updated_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      case 'payout_claimed': {
        await this.store.upsertPayout({
          request_id: (val.request_id as string) || args[0],
          reporter_address: (val.reporter as string) || args[1],
          bounty_reward: (val.bounty_reward as string) || '0',
          stake_returned: (val.stake_returned as string) || '0',
          slash_bonus: (val.slash_bonus as string) || '0',
          slash_penalty: (val.slash_penalty as string) || '0',
          reason_code:
            (val.reason_code as
              'SUCCESS' | 'OUTLIER' | 'NON_REVEAL' | 'FRAUD' | 'UNDERSUBSCRIBED_REFUND') ||
            'SUCCESS',
          claimed: true,
          claimed_at: new Date(event.ledgerClosedAt),
          created_at: new Date(event.ledgerClosedAt),
        });
        break;
      }

      default:
        // Ignore unhandled topics gracefully
        break;
    }
  }
}
