import crypto from 'node:crypto';
import type { StellarRpcEvent, GetEventsResponse, GetEventsFilter } from './types.js';

export class MockStellarRpcClient {
  public events: StellarRpcEvent[] = [];
  public currentLedger = 105500;
  public oldestLedger = 100000;
  public rpcRetentionLimitLedgers = 120000; // ~7 days retention on Stellar RPC

  constructor(initialLedger = 105500) {
    this.currentLedger = initialLedger;
    this.oldestLedger = Math.max(1, initialLedger - this.rpcRetentionLimitLedgers);
  }

  public addEvent(event: Omit<StellarRpcEvent, 'id' | 'pagingToken'>): StellarRpcEvent {
    const id = `${event.ledger.toString().padStart(10, '0')}-${crypto.randomBytes(4).toString('hex')}`;
    const fullEvent: StellarRpcEvent = {
      ...event,
      id,
      pagingToken: id,
    };
    this.events.push(fullEvent);
    return fullEvent;
  }

  public advanceLedger(steps = 1): number {
    this.currentLedger += steps;
    return this.currentLedger;
  }

  public async getEvents(
    startLedger: number,
    filters?: GetEventsFilter[],
    cursor?: string,
    limit = 100,
  ): Promise<GetEventsResponse> {
    // Check retention limits
    if (startLedger < this.oldestLedger) {
      throw new Error(
        `Start ledger ${startLedger} is older than oldest available ledger ${this.oldestLedger} on RPC node (retention limit exceeded)`,
      );
    }

    let filtered = this.events.filter((e) => e.ledger >= startLedger);

    if (cursor) {
      const idx = filtered.findIndex((e) => e.pagingToken === cursor);
      if (idx !== -1) {
        filtered = filtered.slice(idx + 1);
      }
    }

    if (filters && filters.length > 0) {
      filtered = filtered.filter((e) => {
        return filters.some((f) => {
          if (f.contractIds && !f.contractIds.includes(e.contractId)) return false;
          return true;
        });
      });
    }

    const page = filtered.slice(0, limit);
    const nextCursor = page.length > 0 ? page[page.length - 1].pagingToken : cursor;

    return {
      events: page,
      latestLedger: this.currentLedger,
      oldestLedger: this.oldestLedger,
      cursor: nextCursor,
    };
  }

  /**
   * Helper to simulate a full request lifecycle on Soroban contracts
   */
  public simulateRequestLifecycle(requestId: string): StellarRpcEvent[] {
    const now = new Date().toISOString();
    const startLedger = this.currentLedger;

    const requestBoardId = 'CREQUESTBOARD0000000000000000000000000000000000000000001';
    const reportEngineId = 'CREPORTENGINE0000000000000000000000000000000000000000002';
    const oracleFeedId = 'CORACLEFEED00000000000000000000000000000000000000000003';

    // 1. request_created
    const e1 = this.addEvent({
      type: 'contract',
      ledger: startLedger + 1,
      ledgerClosedAt: now,
      contractId: requestBoardId,
      topic: ['request_created', requestId],
      value: {
        request_id: requestId,
        requester: 'GBUYER000000000000000000000000000000000000000000000000',
        data_type: 'RICE50',
        geohash: 's14b3k9x',
        bounty: '50000000',
        min_stake: '2500000',
        min_reports: 5,
        max_reports: 15,
        tolerance_bps: 800,
      },
      inSuccessfulContractCall: true,
    });

    // 2. report_committed (5 reports)
    const commitEvents: StellarRpcEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      const rep = `GREPORTER00000000000000000000000000000000000000000000000${i}`;
      const commitment = crypto.createHash('sha256').update(`value_${i}`).digest('hex');
      commitEvents.push(
        this.addEvent({
          type: 'contract',
          ledger: startLedger + 2,
          ledgerClosedAt: now,
          contractId: reportEngineId,
          topic: ['report_committed', requestId, rep],
          value: {
            request_id: requestId,
            reporter: rep,
            commitment,
            stake: '2500000',
          },
          inSuccessfulContractCall: true,
        }),
      );
    }

    // 3. report_revealed (5 reports, 4 agreement, 1 outlier)
    const revealEvents: StellarRpcEvent[] = [];
    const values = ['8200000', '8250000', '8300000', '8250000', '9500000']; // last one is outlier
    for (let i = 1; i <= 5; i++) {
      const rep = `GREPORTER00000000000000000000000000000000000000000000000${i}`;
      const evHash = crypto.createHash('sha256').update(`evidence_${i}`).digest('hex');
      revealEvents.push(
        this.addEvent({
          type: 'contract',
          ledger: startLedger + 5,
          ledgerClosedAt: now,
          contractId: reportEngineId,
          topic: ['report_revealed', requestId, rep],
          value: {
            request_id: requestId,
            reporter: rep,
            value: values[i - 1],
            evidence_hash: evHash,
          },
          inSuccessfulContractCall: true,
        }),
      );
    }

    // 4. request_resolved (ReportEngine computes weighted median = 8250000)
    const e4 = this.addEvent({
      type: 'contract',
      ledger: startLedger + 10,
      ledgerClosedAt: now,
      contractId: reportEngineId,
      topic: ['request_resolved', requestId],
      value: {
        request_id: requestId,
        median_value: '8250000',
        confidence_bps: 8500,
        accepted_count: 4,
        outlier_count: 1,
        non_reveal_count: 0,
      },
      inSuccessfulContractCall: true,
    });

    // 5. observation_written (written to OracleFeed)
    const e5 = this.addEvent({
      type: 'contract',
      ledger: startLedger + 11,
      ledgerClosedAt: now,
      contractId: oracleFeedId,
      topic: ['observation_written', 'RICE50', 's14b3k9x'],
      value: {
        request_id: requestId,
        data_type: 'RICE50',
        geohash: 's14b3k9x',
        value: '8250000',
        confidence_bps: 8500,
        n_reports: 5,
        finalised_at: now,
      },
      inSuccessfulContractCall: true,
    });

    // 6. payout_claimed (reporter 1 claims accepted payout)
    const rep1 = 'GREPORTER000000000000000000000000000000000000000000000001';
    const e6 = this.addEvent({
      type: 'contract',
      ledger: startLedger + 15,
      ledgerClosedAt: now,
      contractId: reportEngineId,
      topic: ['payout_claimed', requestId, rep1],
      value: {
        request_id: requestId,
        reporter: rep1,
        bounty_reward: '12500000',
        stake_returned: '2500000',
        slash_bonus: '125000',
        slash_penalty: '0',
        reason_code: 'SUCCESS',
      },
      inSuccessfulContractCall: true,
    });

    this.advanceLedger(20);

    return [e1, ...commitEvents, ...revealEvents, e4, e5, e6];
  }
}
