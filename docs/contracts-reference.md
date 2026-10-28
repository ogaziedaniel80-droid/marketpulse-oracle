# Soroban Smart Contracts Reference

**Companion Specification:** `README.md` Section 8 (Smart contract design).  
**Shared Types & Math Crate:** `contracts/shared` (`marketpulse_shared`).

Every state-changing contract function invokes `require_auth()` on the acting address.

---

## 1. `Registry` (`contracts/registry`)

Manages reporter enrollment, community vouching liability, reputation scores (`0..10_000` bps), and tiered stake/weight caps.

| Function                                         | Acting Auth                         | Parameters                                                               | Description                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize(env, admin, report_engine)`          | `admin`                             | `admin: Address, report_engine: Address`                                 | Initializes admin and authorizes `ReportEngine` for reputation updates.                                                                        |
| `enroll(env, reporter, region_geohash, voucher)` | `reporter` (+ `voucher` if present) | `reporter: Address, region_geohash: BytesN<8>, voucher: Option<Address>` | Enrolls a Tier 1 reporter (`5_000` initial reputation bps). Rejects self-vouching.                                                             |
| `get_reporter(env, reporter)`                    | Read-only                           | `reporter: Address`                                                      | Returns `Option<ReporterProfile>`.                                                                                                             |
| `get_weight(env, reporter)`                      | Read-only                           | `reporter: Address`                                                      | Computes aggregation weight `tier_base_weight * reputation_bps / 10_000`.                                                                      |
| `get_stake_cap(env, reporter)`                   | Read-only                           | `reporter: Address`                                                      | Returns maximum stake allowed for the reporter's tier.                                                                                         |
| `update_reputation(env, reporter, delta_bps)`    | `admin` or `report_engine`          | `reporter: Address, delta_bps: i32`                                      | Updates reputation (clamped to `MAX_REP_GAIN_PER_REQUEST` `+250` / `MAX_REP_LOSS_PER_REQUEST` `-1500`). Promotes tier when thresholds are met. |
| `set_status(env, reporter, status)`              | `admin`                             | `reporter: Address, status: ReporterStatus`                              | Suspends, reinstates, or slashes a reporter profile.                                                                                           |
| `extend_reporter_ttl(env, reporter)`             | Permissionless                      | `reporter: Address`                                                      | Extends persistent storage TTL for the reporter record.                                                                                        |
| `version(env)`                                   | Read-only                           | None                                                                     | Returns contract version (`u32`).                                                                                                              |

---

## 2. `RequestBoard` (`contracts/request-board`)

Escrows USDC bounties and manages request creation, cancellation, and under-subscription refunds.

| Function                                            | Acting Auth                              | Parameters                                          | Description                                                                                                           |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `initialize(env, admin, report_engine)`             | `admin`                                  | `admin: Address, report_engine: Address`            | Initializes admin, approved launch data types (`RICE50`, `TOMATO`, etc.), and authorized `ReportEngine`.              |
| `create_request(env, requester, params)`            | `requester`                              | `requester: Address, params: RequestParams`         | Validates bounds (`max_reports <= 15`, deadlines, approved data type) and transfers `params.bounty` USDC into escrow. |
| `cancel_request(env, requester, request_id)`        | `requester`                              | `requester: Address, request_id: u64`               | Cancels an open request and refunds 100% of bounty if zero commits exist.                                             |
| `refund_undersubscribed(env, request_id)`           | Permissionless (after `commit_deadline`) | `request_id: u64`                                   | Refunds requester if `commit_count < min_reports` after `commit_deadline`.                                            |
| `release_funds(env, request_id, recipient, amount)` | `report_engine`                          | `request_id: u64, recipient: Address, amount: i128` | Releases escrowed bounty to `ReportEngine` upon resolution.                                                           |
| `get_request(env, request_id)`                      | Read-only                                | `request_id: u64`                                   | Returns `Option<DataRequest>`.                                                                                        |
| `list_open_requests(env, start_after, limit)`       | Read-only                                | `start_after: u64, limit: u32`                      | Paginated list of open requests (capped at 50 per call).                                                              |
| `version(env)`                                      | Read-only                                | None                                                | Returns contract version (`u32`).                                                                                     |

---

## 3. `ReportEngine` (`contracts/report-engine`)

Implements commit-reveal reporting, reputation-weighted median aggregation, tolerance band verification, gentle outlier slashing (25%), heavy non-reveal slashing (80%), and payout claims.

| Function                                                        | Acting Auth                               | Parameters                                                                                     | Description                                                                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize(env, admin, config)`                                | `admin`                                   | `admin: Address, config: EngineConfig`                                                         | Sets `Registry`, `RequestBoard`, `OracleFeed`, `Disputes`, `Treasury`, `AuditFund`, and fee/slash bps.                                                               |
| `commit(env, reporter, request_id, commitment, stake)`          | `reporter`                                | `reporter: Address, request_id: u64, commitment: BytesN<32>, stake: i128`                      | Locks reporter stake in USDC before `commit_deadline`. Enforces `stake >= min_stake`, `stake <= stake_cap`, and `commits < max_reports`.                             |
| `reveal(env, reporter, request_id, value, salt, evidence_hash)` | `reporter`                                | `reporter: Address, request_id: u64, value: i128, salt: BytesN<32>, evidence_hash: BytesN<32>` | Verifies `sha256(i128_be(value) \|\| salt) == commitment` between `commit_deadline` and `reveal_deadline`.                                                           |
| `resolve(env, request_id)`                                      | Permissionless (after `reveal_deadline`)  | `request_id: u64`                                                                              | Computes reputation-weighted median, `confidence_bps`, outlier slashes (25%), non-reveal slashes (80%), protocol fee, and 50/30/20 slash redistribution. Idempotent. |
| `claim(env, reporter, request_id)`                              | `reporter`                                | `reporter: Address, request_id: u64`                                                           | Transfers net stake + bounty reward + slash bonus to `reporter`. Rejects double-claim.                                                                               |
| `finalise(env, request_id)`                                     | Permissionless (after `challenge_window`) | `request_id: u64`                                                                              | Writes finalised observation to `OracleFeed` once challenge window elapses without active dispute.                                                                   |
| `fraud_hook(env, request_id, reporter)`                         | `disputes` contract                       | `request_id: u64, reporter: Address`                                                           | Invoked on upheld fraud ruling to apply 100% full stake slash and `-1500` bps reputation penalty.                                                                    |
| `version(env)`                                                  | Read-only                                 | None                                                                                           | Returns contract version (`2`).                                                                                                                                      |

---

## 4. `Disputes` (`contracts/disputes`)

Manages challenge bonds, multi-party commit-reveal XOR randomness seeds for audit panel selection, majority voting, and timeout fallback.

| Function                                                           | Acting Auth                          | Parameters                                                                   | Description                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `initialize(env, admin, report_engine, token, treasury, min_bond)` | `admin`                              | `Address, Address, Address, Address, i128`                                   | Configures dispute bond asset and linked `ReportEngine`.                                                               |
| `challenge(env, challenger, request_id, reason_hash, bond)`        | `challenger`                         | `challenger: Address, request_id: u64, reason_hash: BytesN<32>, bond: i128`  | Escrows dispute bond during the request's challenge window.                                                            |
| `commit_seed(env, participant, request_id, seed_hash)`             | `participant` (panel)                | `participant: Address, request_id: u64, seed_hash: BytesN<32>`               | Commits `sha256(seed \|\| nonce)` for multi-party randomness (`docs/randomness.md`).                                   |
| `reveal_seed(env, participant, request_id, seed, nonce)`           | `participant` (panel)                | `participant: Address, request_id: u64, seed: BytesN<32>, nonce: BytesN<32>` | Reveals seed and XOR-accumulates into unpredictable panel selection entropy.                                           |
| `vote(env, arbiter, dispute_id, uphold)`                           | `arbiter` (panel)                    | `arbiter: Address, dispute_id: u64, uphold: bool`                            | Records panel member vote; prevents double-voting.                                                                     |
| `rule(env, dispute_id)`                                            | Permissionless (once quorum reached) | `dispute_id: u64`                                                            | Executes majority ruling: returns bond if upheld (and triggers `fraud_hook`), or slashes bond to treasury if rejected. |
| `resolve_timeout(env, dispute_id)`                                 | Permissionless (after timeout)       | `dispute_id: u64`                                                            | Defaults to `Rejected` if panel fails to rule before deadline, preventing indefinite lockups.                          |

---

## 5. `OracleFeed` (`contracts/oracle-feed`)

Stores and serves finalised market observations for on-chain consumers (`MyConsumer` in README §20).

| Function                                      | Acting Auth               | Parameters                                          | Description                                                                                                             |
| --------------------------------------------- | ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `initialize(env, admin, writer)`              | `admin`                   | `admin: Address, writer: Address`                   | Sets authorized writer (`ReportEngine`).                                                                                |
| `write_observation(env, obs)`                 | `writer` (`ReportEngine`) | `obs: Observation`                                  | Writes latest observation for `(data_type, geohash)` and prepends to bounded FIFO history (`MAX_HISTORY_LENGTH = 100`). |
| `get_latest(env, data_type, geohash)`         | Read-only                 | `data_type: Symbol, geohash: BytesN<8>`             | Returns `Option<Observation>` for the commodity and market geohash.                                                     |
| `get_history(env, data_type, geohash, limit)` | Read-only                 | `data_type: Symbol, geohash: BytesN<8>, limit: u32` | Returns `Vec<Observation>` ordered most-recent first.                                                                   |
| `version(env)`                                | Read-only                 | None                                                | Returns contract version (`u32`).                                                                                       |
