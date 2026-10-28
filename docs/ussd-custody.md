# USSD / SMS Fallback Channel & Custody Trade-Offs (Design Note)

**Status:** Design Note Only (Phase 4 Planned — Not Implemented in v0.1.0-alpha)  
**Companion Specification:** `README.md` Section 12.2 (Channels) & `Plan.md` Decision D4.

---

## 1. Why USSD Cannot Use Standard Passkey Smart Wallets Directly

In the primary PWA (`apps/web`), reporters authenticate with WebAuthn biometric passkeys (`secp256r1` signatures verified by a Soroban smart wallet contract). However, GSM feature phones using USSD (`*384*...#`) or plain SMS have:
1. **No WebAuthn / Secure Enclave hardware** to sign Soroban transaction payloads locally.
2. **Strict session timeouts** (typically 60–120 seconds per GSM USSD session), which requires two separate sessions for the Commit and Reveal phases.
3. **No camera photo upload capability** during a USSD menu session.

---

## 2. Evaluated Signing & Custody Models

| Model | How It Works | Security & Custody Trade-Off |
|---|---|---|
| **A. Server-Custodial KMS Keys** | Backend holds a KMS-encrypted signing key per phone hash unlocked by a 4-digit USSD PIN. | **High custody & regulatory risk:** Platform controls reporter stakes and rewards; database/KMS breach compromises all USSD wallets. |
| **B. Delegated Session Signer (Scoped Sub-Key)** | Reporter creates a non-custodial wallet once (with an agent) and authorizes a restricted session key that can *only* call `commit` and `reveal` (never `claim` or `transfer`). | **Balanced risk:** Backend cannot steal funds or redirect payouts, though a compromised session key could grief stakes via bad reveals. |
| **C. Agent-Assisted Passkey Mode (Recommended for Pilot)** | A staked community vouching agent lends a smartphone in **Agent Mode** (`README.md` §12.2); each reporter signs with their own passkey/PIN or hardware token. | **Lowest custody risk:** Preserves non-custodial signing and photo evidence quality. |

---

## 3. Protocol Guardrails for USSD Reports (When Enabled in Phase 4)

1. **Lower Aggregation Weight:** Because USSD reports lack real-time camera EXIF evidence, `Registry` assigns a lower weight multiplier to USSD-only submissions.
2. **Confirmation Code Salt Storage:** During the Commit session, the gateway generates a short 6-character confirmation salt sent via SMS so the reporter can reveal without re-entering a 32-byte hex salt.
3. **Legal Review Required:** Before enabling Model A or B in any jurisdiction, local legal counsel must review whether holding or delegating stake keys constitutes regulated custody (`docs/data-protection.md`).
