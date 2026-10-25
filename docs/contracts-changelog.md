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
