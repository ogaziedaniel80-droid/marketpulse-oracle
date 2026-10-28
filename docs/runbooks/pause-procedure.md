# Runbook: Emergency Contract Pause Procedure

**Companion Specification:** `README.md` Section 13 & Section 23.  
**Severity:** Critical (P0)  
**Acting Role:** Admin Multisig (2-of-3 or 3-of-5 KMS/Hardware Signers)

---

## 1. When to Trigger a Pause

- Active smart contract vulnerability or accounting invariant violation detected.
- Coordinated Sybil swarm exceeding 50% of active panel capacity in a market.
- Compromised Relayer or Arbiter signer key.

## 2. Step-by-Step Pause Execution

1. **Freeze Off-Chain Intake First (< 60 seconds):**
   - Set `MAINTENANCE_PAUSE=true` on `apps/api` and `apps/worker` to halt new request creation and fee-sponsored commits.
2. **Disable Data Types on `RequestBoard`:**
   ```bash
   stellar contract invoke \
     --id $REQUEST_BOARD_ID \
     --source-account $ADMIN_MULTISIG \
     --network $STELLAR_NETWORK \
     -- set_data_type_approved \
     --admin $ADMIN_ADDRESS \
     --data_type RICE50 \
     --approved false
   ```
3. **Allow In-Flight Reveals & Refunds to Settle Safely:**
   - Do **not** block reporters who have already locked stakes from revealing or claiming refunds on under-subscribed requests, so honest reporters are never griefed by an emergency pause.

## 3. Unpause & Recovery Verification

1. Run `cargo test --workspace` and verify the fix on testnet.
2. Re-enable approved data types on `RequestBoard`.
3. Announce incident post-mortem in `docs/contracts-changelog.md`.
