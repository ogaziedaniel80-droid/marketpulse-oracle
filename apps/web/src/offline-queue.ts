export type OfflineActionType = 'commit' | 'reveal';

export type OfflineQueueState =
  | 'QUEUED_OFFLINE'
  | 'RETRYING'
  | 'SYNCED'
  | 'EXPIRED_DEADLINE'
  | 'FAILED';

export interface OfflineQueueItem {
  idempotencyKey: string;
  action: OfflineActionType;
  requestId: string;
  reporterAddress: string;
  payload: Record<string, unknown>;
  deadlineTimestampSec: number;
  state: OfflineQueueState;
  attempts: number;
  txHash?: string;
  lastError?: string;
  createdAtSec: number;
  updatedAtSec: number;
}

export type QueueDispatcher = (item: OfflineQueueItem) => Promise<{ txHash: string }>;

/**
 * Offline-first queue for reporter commits and reveals.
 * Guarantees:
 * 1. Never double-commits (deduplicates by idempotency key: `${action}:${requestId}:${reporterAddress}`).
 * 2. Respects deadlines: never submits an item whose commit/reveal deadline has expired.
 * 3. Exposes clear state transitions for UI display.
 */
export class OfflineQueueManager {
  private items = new Map<string, OfflineQueueItem>();
  private isOnline = true;

  public setOnlineStatus(online: boolean): void {
    this.isOnline = online;
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public static buildIdempotencyKey(
    action: OfflineActionType,
    requestId: string,
    reporterAddress: string,
  ): string {
    return `${action}:${requestId}:${reporterAddress}`;
  }

  public enqueue(params: {
    action: OfflineActionType;
    requestId: string;
    reporterAddress: string;
    payload: Record<string, unknown>;
    deadlineTimestampSec: number;
    nowSec?: number;
  }): OfflineQueueItem {
    const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);
    const idempotencyKey = OfflineQueueManager.buildIdempotencyKey(
      params.action,
      params.requestId,
      params.reporterAddress,
    );

    const existing = this.items.get(idempotencyKey);
    if (existing) {
      // Never double-commit or overwrite an already queued/synced commitment
      if (existing.state === 'SYNCED' || existing.state === 'QUEUED_OFFLINE') {
        throw new Error(
          `DuplicateSubmissionPrevented: ${params.action} for request ${params.requestId} already ${existing.state}`,
        );
      }
    }

    const initialState: OfflineQueueState =
      nowSec > params.deadlineTimestampSec ? 'EXPIRED_DEADLINE' : 'QUEUED_OFFLINE';

    const item: OfflineQueueItem = {
      idempotencyKey,
      action: params.action,
      requestId: params.requestId,
      reporterAddress: params.reporterAddress,
      payload: params.payload,
      deadlineTimestampSec: params.deadlineTimestampSec,
      state: initialState,
      attempts: 0,
      createdAtSec: nowSec,
      updatedAtSec: nowSec,
    };

    this.items.set(idempotencyKey, item);
    return item;
  }

  public listItems(): OfflineQueueItem[] {
    return Array.from(this.items.values());
  }

  public getItem(idempotencyKey: string): OfflineQueueItem | undefined {
    return this.items.get(idempotencyKey);
  }

  /**
   * Flush queued items when network connectivity returns.
   * Respects deadlines before every network call.
   */
  public async flushQueue(
    dispatcher: QueueDispatcher,
    nowSec: number = Math.floor(Date.now() / 1000),
  ): Promise<OfflineQueueItem[]> {
    if (!this.isOnline) {
      return this.listItems();
    }

    for (const item of this.items.values()) {
      if (item.state !== 'QUEUED_OFFLINE' && item.state !== 'FAILED') {
        continue;
      }

      // Guardrail: never submit a commit or reveal after its deadline
      if (nowSec > item.deadlineTimestampSec) {
        item.state = 'EXPIRED_DEADLINE';
        item.lastError = 'Submission deadline passed while device was offline';
        item.updatedAtSec = nowSec;
        continue;
      }

      item.state = 'RETRYING';
      item.attempts += 1;
      item.updatedAtSec = nowSec;

      try {
        const res = await dispatcher(item);
        item.state = 'SYNCED';
        item.txHash = res.txHash;
        item.lastError = undefined;
        item.updatedAtSec = nowSec;
      } catch (err) {
        item.state = 'FAILED';
        item.lastError = err instanceof Error ? err.message : String(err);
        item.updatedAtSec = nowSec;
      }
    }

    return this.listItems();
  }
}
