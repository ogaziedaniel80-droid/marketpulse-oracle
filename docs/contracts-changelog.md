# Smart Contracts Changelog

All notable changes to the MarketPulse Soroban smart contracts are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0] - 2026-10-25

### Added

- **Monorepo & CI Foundation:**
  - Cargo workspace with 6 member crates (`shared`, `registry`, `request-board`, `report-engine`, `disputes`, `oracle-feed`).
  - Tooling configs: `rust-toolchain.toml` (stable Rust 1.96.0, `wasm32v1-none`), `.editorconfig`, `.gitignore`, `.nvmrc`, `.eslintrc.cjs`, `.prettierrc`, `ruff.toml`.
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`).
  - GitHub issue templates and PR template with contract-change checklist.
  - Local infrastructure compose (`infra/docker/compose.dev.yml`) with PostGIS, Redis, MinIO.
  - Complete `.env.example` matching README Section 15.
- **Data Types Specifications (`packages/shared/src/datatypes`):**
  - Launch Wave 1 specifications and TypeScript definitions: `RICE50`, `GARRI`, `MAIZE`, `TOMATO`, `FUEL_PMS`, `FUEL_DSL`.
  - Second-wave stubs flagged disabled by default: `POWER`, `ROAD`, `LPG`, `FX_PARALLEL`, `CHECKPOINT`. Explicit safety and legal review flags for `FX_PARALLEL` and `CHECKPOINT`.
  - Comprehensive Zod validation schemas for data types, request parameters, commitments, and observations.
- **Shared Contracts Crate (`contracts/shared`):**
  - Core domain types: `RequestStatus`, `Request`, `Report`, `Observation`, `RequestParams`, `ReputationInfo`, `ReporterStatus`, `ReporterTier`.
  - Stable numeric contract error enum `ContractError` covering all contract failure modes.
  - Default economic parameters from README Section 10 in `constants.rs`.
  - Math helpers in `math.rs`: checked basis-point arithmetic (`bps_mul`, `bps_div`, `bps_diff`), fixed-point operations, tolerance checking, and deterministic `weighted_median` with exact 50% tie-breaking rule.
  - Cross-contract client interfaces: `RegistryClient`, `RequestBoardClient`, and `OracleFeedClient`.
- **Registry Contract (`contracts/registry`):**
  - Reporter enrollment with caller authentication, initial Tier 1 status, and attestation hash storage.
  - Slow-up / fast-down reputation scoring with bounded changes per request (`max_delta_per_req`).
  - Tier promotion (Tier 1 -> 2 -> 3) and demotion logic.
  - Role-based authorization for reputation and status mutations.
  - Fraud reset and permanent ban functionality.
  - Community vouching with locked voucher stake and voucher liability slashing on proven fraud.
  - Typed contract events for all state changes using `#[contractevent]`.
- **RequestBoard Contract (`contracts/request-board`):**
  - Request creation with parameter validation (deadlines, bounties, stakes, report counts, approved data types).
  - USDC bounty escrow via Soroban Token SAC interface.
  - Full refund cancellation before any commits exist.
  - Under-subscription refund path after commit deadline when quorum cannot be met.
  - Approved data type registry initialized with 6 launch types.
  - Views: `get_request`, `request_status`, `is_approved_data_type`, `list_open_requests` pagination.
  - Persistent storage TTL management (250,000 ledgers initial extension).
- **Verification & Testing:**
  - 28 unit, integration, and property tests across workspace.
  - Property test (`proptest`) verifying exact escrow balance conservation invariant:
    `token_balance(RequestBoard) == sum(open_bounties)`.
  - Zero compiler warnings, clean Clippy and Prettier formatting.
  - Optimized Wasm sizes: `marketpulse_registry.wasm` (16,480 bytes), `marketpulse_request_board.wasm` (14,646 bytes).

---

## [0.2.0] - 2026-10-26

### Added

- **`contracts/shared`**
  - New types: `DisputeRecord`, `PayoutRecord`, `ResolutionResult`, `SeedCommitment`,
    `AssignmentSeed` (used by ReportEngine and Disputes).
  - New error codes: `RequestNotRevealable`, `RequestNotResolvable`, `RequestNotFinalisable`,
    `RequestNotChallengeable`, `NoRevealedReports`, `InsufficientBond`, `NotPanelMember`,
    `AlreadyVoted`, `PanelRulingTimeout`, `DisputeNotActive`, `NotAuthorizedWriter`,
    `HistoryLimitExceeded` (errors 50–61).
  - New constants: `DEFAULT_PANEL_SIZE`, `DEFAULT_RULING_WINDOW_SECONDS`,
    `DEFAULT_TIMEOUT_OUTCOME_UPHELD`, `REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS`,
    `REJECTED_DISPUTE_BOND_TREASURY_BPS`, `MAX_HISTORY_LENGTH`, `DEFAULT_HISTORY_LIMIT`.
  - Updated `interfaces.rs` to include `ReportEngineInterface` and `DisputesInterface`
    contract client traits.

- **`contracts/report-engine`** (full implementation, version 2)
  - `initialize`: wires Registry, RequestBoard, OracleFeed, treasury, audit fund.
  - `commit`: require_auth; active reporter check; stake cap + min stake validation;
    deadline guard; duplicate-commit guard; max_reports enforcement via Board;
    snapshot weight_bps; transfer stake to engine; populate reporter list inline.
  - `reveal`: commitment verification (`sha256(value_le || salt)`); deadline window;
    duplicate-reveal guard; status transition to Revealing.
  - `resolve`: idempotent; pulls bounty from Board via `release_funds`; collects
    committed/revealed reports; under-subscription path (refund + slash non-revealers);
    weighted median; tolerance classification; confidence_bps formula; outlier/non-reveal
    slash; bounty split (protocol fee, accepted pool, slash distributions); dust sink;
    reputation updates; sets Challengeable; records ResolutionResult.
  - `claim`: single-claim enforced; pays reporter from engine balance.
  - `finalise`: challenge window guard; writes Observation to OracleFeed; sets Finalised.
  - `apply_fraud_slash`: Disputes-only hook; full slash; reputation ban; voucher liability.
  - 21 unit tests (including proptest exact-accounting, weighted median with NGN values,
    max_reports=15 resource budget test).

- **`contracts/oracle-feed`** (full implementation, version 2)
  - `initialize`: sets admin and authorised writer (ReportEngine).
  - `write_observation`: writer-only; updates Latest; appends to History with FIFO pruning
    at `MAX_HISTORY_LENGTH = 100`.
  - `get_latest`, `get_history`: public read-only; history returned most-recent first.
  - `set_writer`, `set_admin`: admin-only management.
  - 11 unit tests.

- **`contracts/disputes`** (full implementation, version 2)
  - `initialize`: wires ReportEngine, RequestBoard, treasury, audit fund.
  - `challenge`: bond ≥ 5× min_stake; single dispute per request; sets status Disputed.
  - `rule`: panel-member-only; duplicate-vote guard; majority-triggers ruling;
    upheld → bond returned + request voided; rejected → bond slashed (70% audit, 30% treasury).
  - `resolve_timeout`: permissionless after `ruling_deadline`; default outcome = rejected.
  - `submit_seed_commitment` / `reveal_seed`: multi-party commit-reveal XOR seed protocol.
  - `register_panel_member` / `remove_panel_member`: admin-only.
  - 18 unit tests (including seed protocol, timeout, adversarial scenarios).

- **`contracts/request-board`**
  - `release_funds`: new function callable by authorised callers (ReportEngine) to
    transfer bounty shares from board escrow; used during `resolve()`.

### Changed

- `RequestBoard` version remains 1; `ReportEngine` and `OracleFeed` bumped to version 2.

### Documentation

- `docs/confidence.md`: formula for `confidence_bps`.
- `docs/randomness.md`: multi-party seed protocol and assignment design.
- `docs/threat-model.md`: all README section 11 attacks mapped to mitigations.
- `docs/benchmarks.md`: CPU/memory measurements, max_reports justification.
- `scripts/deploy-testnet.sh`: full idempotent deploy script.
- `scripts/bindings-generate.js`: TypeScript bindings generation.
- `scripts/local-network.md`: local development network guide.

---

## [0.2.0] - 2026-10-26

### Added

- **`contracts/shared`**
  - New types: `DisputeRecord`, `PayoutRecord`, `ResolutionResult`, `SeedCommitment`, `AssignmentSeed`.
  - New error codes 50–61: `RequestNotRevealable`, `RequestNotResolvable`, `RequestNotFinalisable`,
    `RequestNotChallengeable`, `NoRevealedReports`, `InsufficientBond`, `NotPanelMember`,
    `AlreadyVoted`, `PanelRulingTimeout`, `DisputeNotActive`, `NotAuthorizedWriter`, `HistoryLimitExceeded`.
  - New constants: `DEFAULT_PANEL_SIZE`, `DEFAULT_RULING_WINDOW_SECONDS`, `DEFAULT_TIMEOUT_OUTCOME_UPHELD`,
    `REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS`, `REJECTED_DISPUTE_BOND_TREASURY_BPS`, `MAX_HISTORY_LENGTH`,
    `DEFAULT_HISTORY_LIMIT`.
  - Updated `interfaces.rs`: `ReportEngineInterface` and `DisputesInterface` contract client traits.

- **`contracts/report-engine`** — full implementation, version 2
  - `commit`: require_auth; active-reporter check; stake cap/min validation; deadline guard;
    duplicate-commit guard; max_reports via Board; weight snapshot; stake transfer; reporter
    list built inline.
  - `reveal`: sha256(value_le || salt) commitment verification; window guard; duplicate-reveal guard.
  - `resolve`: idempotent; pulls bounty via `RequestBoard::release_funds`; weighted median;
    tolerance classification; confidence_bps formula; outlier/non-reveal slash; bounty split;
    dust sink; reputation updates; sets Challengeable.
  - `claim`: single-claim enforced.
  - `finalise`: challenge-window guard; writes to OracleFeed; sets Finalised.
  - `apply_fraud_slash`: Disputes-only hook; full slash + ban + voucher liability.
  - **21 unit + proptest tests** all passing.

- **`contracts/oracle-feed`** — full implementation, version 2
  - `write_observation`: writer-only; Latest + History (FIFO-pruned at 100).
  - `get_latest`, `get_history`: public read-only, most-recent first.
  - **11 unit tests** all passing.

- **`contracts/disputes`** — full implementation, version 2
  - `challenge`: bond ≥ 5× min_stake; single dispute per request.
  - `rule`: majority panel ruling; bond returned (upheld) or slashed 70/30 (rejected).
  - `resolve_timeout`: default outcome = rejected.
  - Multi-party commit-reveal XOR seed protocol (`submit_seed_commitment` / `reveal_seed`).
  - **18 unit tests** all passing.

- **`contracts/request-board`**
  - `release_funds`: authorized-caller function; transfers bounty shares from Board escrow
    to a recipient (used by ReportEngine during resolve).

### Docs added

- `docs/confidence.md`, `docs/randomness.md`, `docs/threat-model.md`, `docs/benchmarks.md`
- `scripts/deploy-testnet.sh`, `scripts/bindings-generate.js`, `scripts/local-network.md`
