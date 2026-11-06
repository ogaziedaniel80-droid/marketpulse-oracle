import type { StellarRpcEvent, GetEventsResponse, GetEventsFilter } from './types.js';

export interface LiveStellarRpcConfig {
  rpcUrl: string;
  timeoutMs?: number;
}

export class LiveStellarRpcClient {
  private rpcUrl: string;
  private timeoutMs: number;

  constructor(config: LiveStellarRpcConfig) {
    if (!config.rpcUrl) {
      throw new Error('LiveStellarRpcClient requires rpcUrl');
    }
    this.rpcUrl = config.rpcUrl;
    this.timeoutMs = config.timeoutMs || 10000;
  }

  public async getLatestLedger(): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
        }),
      });

      if (!response.ok) {
        throw new Error(`Stellar RPC HTTP error: ${response.status}`);
      }

      const data = (await response.json()) as {
        result?: { sequence: number };
        error?: { message: string };
      };

      if (data.error) {
        throw new Error(`Stellar RPC error: ${data.error.message}`);
      }

      return data.result?.sequence || 100000;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async getEvents(
    startLedger: number,
    filters?: GetEventsFilter[],
    cursor?: string,
    limit = 100,
  ): Promise<GetEventsResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const params: Record<string, unknown> = {
        startLedger,
        limit,
      };

      if (filters && filters.length > 0) {
        params.filters = filters;
      }

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getEvents',
          params,
        }),
      });

      if (!response.ok) {
        throw new Error(`Stellar RPC getEvents HTTP error: ${response.status}`);
      }

      const data = (await response.json()) as {
        result?: {
          events?: Array<{
            id: string;
            type: string;
            ledger: number;
            ledgerClosedAt: string;
            contractId: string;
            topic: string[];
            value: Record<string, unknown>;
            pagingToken: string;
            inSuccessfulContractCall: boolean;
          }>;
          latestLedger: number;
          oldestLedger?: number;
          cursor?: string;
        };
        error?: { message: string };
      };

      if (data.error) {
        throw new Error(`Stellar RPC getEvents error: ${data.error.message}`);
      }

      const rawEvents = data.result?.events || [];
      const events: StellarRpcEvent[] = rawEvents.map((e) => ({
        id: e.id,
        type: (e.type as 'contract' | 'system' | 'diagnostic') || 'contract',
        ledger: e.ledger,
        ledgerClosedAt: e.ledgerClosedAt,
        contractId: e.contractId,
        topic: e.topic,
        value: e.value,
        pagingToken: e.pagingToken || e.id,
        inSuccessfulContractCall: e.inSuccessfulContractCall ?? true,
      }));

      const latestLedger = data.result?.latestLedger || startLedger;
      const oldestLedger = data.result?.oldestLedger || Math.max(1, latestLedger - 120000);

      return {
        events,
        latestLedger,
        oldestLedger,
        cursor: data.result?.cursor,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
