# Runbook: Fee-Sponsoring Relayer XLM Top-Up

**Companion Specification:** `README.md` Section 12.4 & Section 23.  
**Trigger Alert:** `marketpulse_relayer_balance_xlm < 250`

---

## 1. Context

Reporters never hold XLM (`requiresXlmGas: false`). Every reporter `commit`, `reveal`, and `claim` transaction is fee-bumped by the Relayer hot account. If the Relayer XLM balance runs dry, reporter submissions queue in the PWA offline queue until the Relayer is funded.

## 2. Top-Up Procedure

1. **Check Current Relayer Balance & Spend Rate:**
   ```bash
   curl -s http://localhost:9090/metrics | grep marketpulse_relayer
   ```
2. **Transfer XLM from Operations Treasury to Relayer Address:**
   - Send `1,000 XLM` (testnet: use Friendbot `stellar keys fund $RELAYER_ADDRESS --network testnet`).
3. **Audit Abnormal Gas Drain (If Applicable):**
   - If daily XLM spend spiked > 3x baseline, inspect `apps/api` rate-limit logs (`rateLimitHits`) to confirm an unauthenticated caller is not spamming `POST /v1/relay`.
