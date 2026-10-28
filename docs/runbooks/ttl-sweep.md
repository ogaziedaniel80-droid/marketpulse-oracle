# Runbook: Soroban Storage TTL Extension Sweep

**Companion Specification:** `README.md` Section 8.2 & Section 23 (`docs/contracts-storage.md`).  
**Trigger Alert:** `ttl_extension_sweep` job failure or entry TTL < `30,000` ledgers (~2 days)

---

## 1. Context

Soroban persistent storage entries (`ReporterProfile`, finalised `Observation`, contract instances) expire unless their Time-To-Live (TTL) is periodically bumped. While every mutating contract call bumps its own TTL (`extend_ttl`), dormant reporter profiles and historical feed entries are maintained by the Worker's `ttl_extension_sweep` BullMQ job.

## 2. Manual Sweep Procedure

1. **Extend Contract Instance TTLs:**
   ```bash
   for CID in $REGISTRY_ID $REQUEST_BOARD_ID $REPORT_ENGINE_ID $DISPUTES_ID $ORACLE_FEED_ID; do
     stellar contract extend \
       --id $CID \
       --source-account $RELAYER_KEY \
       --network $STELLAR_NETWORK \
       --ledgers-to-extend 535680
   done
   ```
2. **Extend Reporter Profiles via `Registry::extend_reporter_ttl`:**
   - Trigger the Worker queue job `ttl_extension_sweep` or invoke `extend_reporter_ttl` for active reporter addresses in the PostgreSQL `reporters` table.
