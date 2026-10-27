export interface StellarEventTopic {
  type: string;
  value: string;
}

export interface StellarRpcEvent {
  id: string;
  type: 'contract' | 'system' | 'diagnostic';
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: Record<string, unknown>;
  pagingToken: string;
  inSuccessfulContractCall: boolean;
}

export interface GetEventsResponse {
  events: StellarRpcEvent[];
  latestLedger: number;
  oldestLedger: number;
  cursor?: string;
}

export interface GetEventsFilter {
  type: 'contract';
  contractIds?: string[];
  topics?: string[][];
}
