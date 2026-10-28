# Runbook: Stellar Soroban RPC Failover

**Companion Specification:** `README.md` Section 18 & Section 23.  
**Trigger Alert:** `marketpulse_rpc_errors_total` spike or `marketpulse_indexer_lag_ledgers > 50`

---

## 1. Symptoms

- `apps/worker` logs connection timeouts or 5xx responses from `STELLAR_RPC_URL`.
- Prometheus gauge `marketpulse_indexer_lag_ledgers` exceeds 50 ledgers (~4 minutes).

## 2. Failover Procedure

1. **Verify Secondary RPC Health:**
   ```bash
   curl -s -X POST $STELLAR_RPC_FALLBACK_URL \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```
2. **Switch Primary RPC Endpoint:**
   - Update `STELLAR_RPC_URL` in environment config to the healthy secondary provider and restart `apps/worker` and `apps/api`.
3. **Verify Cursor Continuity:**
   - The indexer reads its last persisted `last_ledger` cursor from the `indexer_state` table (`docs/indexer-backfill.md`) and resumes idempotently without duplicating events.
4. **If Gap Exceeds 7-Day RPC Retention (`120,000` ledgers):**
   - Follow the archive backfill procedure in [`docs/indexer-backfill.md`](../indexer-backfill.md).
