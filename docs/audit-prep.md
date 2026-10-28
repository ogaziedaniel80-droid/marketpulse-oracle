# Smart Contract Security & Audit Preparation Package

**Version:** `v0.1.0-alpha` (Testnet Only — **Unaudited**)  
**Companion Specification:** `README.md` Section 13 (Security model and audit checklist) & [`docs/threat-model.md`](./threat-model.md).

---

## 1. Audit Scope & Contract Inventory

| Crate / Contract            | Path                      | Wasm Size (Optimized)      | Unit / Property Tests                        | Status   |
| --------------------------- | ------------------------- | -------------------------- | -------------------------------------------- | -------- |
| `marketpulse_shared`        | `contracts/shared`        | _(Library crate)_          | 11 tests                                     | Complete |
| `marketpulse_registry`      | `contracts/registry`      | 16,480 bytes (16.1 KB)     | 6 tests                                      | Complete |
| `marketpulse_request_board` | `contracts/request-board` | 14,646 bytes (14.3 KB)     | 8 tests (incl. proptest)                     | Complete |
| `marketpulse_report_engine` | `contracts/report-engine` | ~22.4 KB (`wasm32v1-none`) | 21 tests (incl. proptest & `max_reports=15`) | Complete |
| `marketpulse_disputes`      | `contracts/disputes`      | ~18.2 KB (`wasm32v1-none`) | 18 tests                                     | Complete |
| `marketpulse_oracle_feed`   | `contracts/oracle-feed`   | ~12.8 KB (`wasm32v1-none`) | 11 tests                                     | Complete |

---

## 2. Core Protocol Invariants Verified by Property Tests

1. **Escrow Conservation (`prop_exact_accounting` & `prop_contract_balance_equals_sum_of_open_bounties`):**
   - Total USDC transferred out across `protocol_fee` + `accepted_reporter_payouts` + `slash_bonus_50%` + `audit_fund_30%` + `treasury_slash_20%` + `returned_stakes` **equals** `bounty + sum(committed_stakes)` down to the single stroop (any integer division rounding dust goes deterministically to `treasury`).
2. **Authorization Completeness:**
   - Every state-changing function across all 5 contracts invokes `require_auth()` on the acting `Address` (`test_unauthorized_callers_rejected_for_every_admin_and_status_function`).
3. **No Double-Commit, Double-Reveal, or Double-Claim:**
   - Enforced by persistent storage state checks and verified in `contracts/report-engine`.
4. **Bounded Resource Execution (`max_reports = 15`):**
   - Verified in [`docs/benchmarks.md`](./benchmarks.md) (`test_resolve_at_max_reports_15_completes`): worst-case resolution consumes ~12.6% of Soroban CPU instruction limits.

---

## 3. Pre-Mainnet Checklist Status (`README.md` §13)

Per engineering honesty rules, no item is marked `done` unless fully verified in this repository:

| Checklist Item (`README.md` §13)                                     | Status          | Evidence / Remaining Gap                                                                                                                                       |
| -------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent smart contract audit (at least one reputable firm)       | **not started** | This package prepares the codebase for external audit selection in Phase 3.                                                                                    |
| Property-based tests for escrow and payout invariants                | **done**        | `prop_exact_accounting` (`report-engine`) and `prop_contract_balance_equals_sum_of_open_bounties` (`request-board`) pass under `proptest`.                     |
| Fuzzing for reveal, resolve, and claim paths                         | **partial**     | Property-based fuzzing via `proptest` (256 cases + regression seed corpus) passes; continuous `cargo-fuzz` libFuzzer targets are planned for Phase 3.          |
| Resource-budget benchmarks at `max_reports` and worst-case inputs    | **done**        | Verified at `max_reports = 15` in `test_resolve_at_max_reports_15_completes` and documented in [`docs/benchmarks.md`](./benchmarks.md).                        |
| TTL management tested (no expiry of active data)                     | **done**        | `extend_ttl` verified in contract storage and Worker `ttl_extension_sweep` job (`apps/worker/test/worker.test.ts`).                                            |
| Admin key setup: multisig, hardware-backed keys, documented ceremony | **partial**     | Multisig runbooks documented (`docs/runbooks/`); live HSM/KMS ceremony not yet executed for mainnet.                                                           |
| Upgrade path with time lock and public announcement                  | **not started** | Planned for Phase 3 hardening before mainnet launch.                                                                                                           |
| Economic simulation reviewed against attack scenarios                | **done**        | Agent-based Monte-Carlo simulation (`pnpm simulate:economics`) and [`docs/economic-simulation.md`](./economic-simulation.md) complete.                         |
| Bug bounty programme live before significant value is held           | **not started** | Scheduled for Phase 4 pre-mainnet gate.                                                                                                                        |
| Incident response runbook and pause mechanism tested                 | **done**        | Documented in [`docs/runbooks/pause-procedure.md`](./runbooks/pause-procedure.md) and [`docs/runbooks/incident-response.md`](./runbooks/incident-response.md). |
| Legal review in each launch country                                  | **not started** | Data mapping prepared in [`docs/data-protection.md`](./data-protection.md); external legal counsel sign-off pending.                                           |
| Privacy review: no personal data on-chain                            | **done**        | Verified across all 5 contracts and PostgreSQL migrations (`001_initial_schema.up.sql`).                                                                       |

---

## 4. Known Gaps & Focus Areas for External Auditors

1. **On-Chain Assignment Enforcement:** While `Disputes` implements the multi-party commit-reveal XOR randomness seed (`docs/randomness.md`), `ReportEngine::commit` currently allows any active Tier-eligible reporter to commit up to `max_reports` rather than restricting commits to a pre-drawn assignment subset.
2. **External Windfall Bribe Resistance:** As shown in [`docs/economic-simulation.md`](./economic-simulation.md), high-value parametric insurance consumers must enforce multi-observation delays and larger panels (`min_reports >= 15`).
3. **Live External Integrations:** External SMS (`Africa's Talking`), fiat billing (`Paystack`/`Flutterwave`), S3, and Relayer services currently run against deterministic local mocks (`packages/shared/src/services/index.ts`).
