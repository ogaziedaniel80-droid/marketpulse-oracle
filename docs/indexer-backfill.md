# Stellar RPC Event Indexer Backfill Strategy

**Document Status:** Approved  
**Applies To:** `apps/worker/src/indexer`  
**Reference:** README.md Section 7, 8.5, 18

---

## 1. Context & Limitation

The MarketPulse indexer relies on the Stellar RPC `getEvents` endpoint to mirror Soroban smart contract events into PostgreSQL.

Stellar RPC nodes maintain a **bounded historical retention window** (typically 7 to 14 days, approximately 120,000 to 240,000 ledgers at 5 seconds per ledger closure). Once a ledger is purged from the RPC node's ephemeral ledger store:

1. `getEvents` with `startLedger < oldestAvailableLedger` will return an error or empty result.
2. If the indexer worker has been stopped, disconnected, or partition-isolated for longer than this retention window, an unbridgeable gap in the RPC stream occurs.

---

## 2. Ingestion Architecture

```
[Chain Head]
     │
     ▼
[Stellar RPC Node (Retention: L_oldest .. L_latest)]
     │
     ├─ Normal path: continuous poll getEvents(startLedger, cursor)
     │
     └─ Gap detected (stored_cursor < L_oldest)
            │
            ▼
   [Backfill Strategy Triggered]
            │
            ├─ 1. Query Stellar History Archives (GCS/S3) for ledger close meta
            ├─ 2. Parse Soroban TransactionMeta.v3.events (sc_event XDR)
            ├─ 3. Ingest missing range [stored_cursor .. L_oldest] idempotently into Postgres
            └─ 4. Seamlessly transition back to live RPC getEvents stream
```

---

## 3. Backfill Procedures

### 3.1 Gap Detection

On every indexing tick, `EventIndexer` compares the persisted database cursor (`event_cursor.ledger_sequence`) against the node's `oldestLedger`:

- If `cursor.ledger >= oldestLedger`: Continue real-time incremental polling.
- If `cursor.ledger < oldestLedger`: Flag `BACKFILL_REQUIRED` and pause live queue resolution triggers until backfill completes.

### 3.2 Historical Archive Catch-up

For gaps exceeding the RPC node's retention:

1. **Archive Ingestion:** The worker invokes the archive reader against Stellar History Archives (`https://history.stellar.org/prd/core-live/core-live-001/` or testnet equivalent).
2. **Event Extraction:** Reads `LedgerCloseMeta` XDR files, extracting all `contract_event` entries whose `contract_id` matches:
   - `RequestBoard`
   - `ReportEngine`
   - `OracleFeed`
   - `Disputes`
   - `Registry`
3. **Idempotency Guarantee:** Every row written uses PostgreSQL `ON CONFLICT (id) DO UPDATE` or `ON CONFLICT DO NOTHING`. Replaying events does not produce duplicate payouts, requests, or reports.

---

## 4. Operational Monitoring & Runbook

- **Metric:** `indexer_lag_ledgers` tracks `latest_ledger - cursor_ledger`.
- **Alert:** If `indexer_lag_ledgers > 50000`, send high-priority PagerDuty / Sentry alert before RPC retention horizon is breached.
- **Failover:** If primary RPC provider fails, indexer switches to secondary standby RPC endpoint automatically.
