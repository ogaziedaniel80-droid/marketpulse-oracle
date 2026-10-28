# Runbook: Dispute Arbiter & Audit Panel Rotation

**Companion Specification:** `README.md` Section 8.1 & Section 23.  
**Acting Role:** Admin Multisig

---

## 1. Routine Rotation Schedule

Audit panel members (`contracts/disputes`) are rotated monthly or immediately if a panelist fails to reveal their randomness seed (`commit_seed` / `reveal_seed`) or exhibits conflict of interest.

## 2. Step-by-Step Rotation

1. **Generate & Verify New Arbiter Hardware Key:**
   - Provision a dedicated KMS / hardware-backed Stellar account (`GNEW_ARBITER...`).
   - Confirm the new arbiter has no active disputes where they are a party.
2. **Add New Panel Member on `Disputes` Contract:**
   ```bash
   stellar contract invoke \
     --id $DISPUTES_ID \
     --source-account $ADMIN_MULTISIG \
     --network $STELLAR_NETWORK \
     -- set_panel_member \
     --admin $ADMIN_ADDRESS \
     --member $NEW_ARBITER_ADDRESS \
     --active true
   ```
3. **Deactivate Outgoing Panel Member:**
   ```bash
   stellar contract invoke \
     --id $DISPUTES_ID \
     --source-account $ADMIN_MULTISIG \
     --network $STELLAR_NETWORK \
     -- set_panel_member \
     --admin $ADMIN_ADDRESS \
     --member $OLD_ARBITER_ADDRESS \
     --active false
   ```
4. **Audit Trail:**
   - Record the rotation transaction hash and signers in `docs/parameter-log.md`.
