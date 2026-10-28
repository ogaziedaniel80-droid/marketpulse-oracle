# Changelog

All notable changes to `marketpulse-oracle` are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

---

## [v0.1.0-alpha] - 2026-10-28

> **IMPORTANT RELEASE NOTICE (`v0.1.0-alpha`):**
>
> - **Testnet & Local Development Only:** Do **not** deploy to Stellar Mainnet or lock real user funds.
> - **Unaudited Smart Contracts:** The Soroban contracts have not yet undergone an independent external security audit (see [`docs/audit-prep.md`](./docs/audit-prep.md)).
> - **Mocks in Place of Live Integrations:** External providers (Africa's Talking SMS, Paystack/Flutterwave billing, S3/MinIO, Pinata IPFS, and the fee-sponsoring Relayer) default to deterministic local mocks (`packages/shared/src/services/index.ts`).

### Added

- **Soroban Smart Contracts (`contracts/`):**
  - `Registry`: Reporter enrollment, community vouching liability, reputation scoring (`0..10_000` bps), and Tier 1–3 stake/weight caps.
  - `RequestBoard`: Escrowed USDC bounty requests, parameter validation, cancellation, and under-subscription refunds.
  - `ReportEngine`: Commit-reveal (`sha256(i128_be(value) || salt_32)`), reputation-weighted median, tolerance bands, gentle outlier slashing (`25%`), heavy non-reveal slashing (`80%`), `50/30/20` slash redistribution, and `100%` fraud hook.
  - `Disputes`: Challenge bonds, multi-party commit-reveal XOR randomness seed, majority voting, and timeout fallback.
  - `OracleFeed`: Writer-authorized observation publishing and bounded FIFO history (`MAX_HISTORY_LENGTH = 100`).
- **Database & Shared Packages (`packages/shared`, `packages/bindings`, `packages/ui`):**
  - 15-table PostgreSQL/PostGIS schema (`001_initial_schema.up.sql`) with reversible migrations (`pg-mem` verified).
  - Launch data type specifications (`RICE50`, `TOMATO`, `GARRI`, `MAIZE`, `FUEL_PMS`, `FUEL_DSL`) and disabled second-wave types (`POWER`, `ROAD`, `LPG`, `FX_PARALLEL`, `CHECKPOINT`).
- **Backend API & Worker (`apps/api`, `apps/worker`):**
  - Fastify REST API + OpenAPI 3.1 spec (`apps/api/openapi.yaml`) for Buyers, Reporters, and Admins.
  - Idempotent Stellar RPC event indexer, Redis leader election, 8 BullMQ job processors, and Prometheus `/metrics` exporter.
- **Offline-First Web PWA (`apps/web`):**
  - Reporter OTP sign-in, `WalletProvider` (`MockWalletProvider` + `PasskeyKitWalletAdapter`), 3-task no-stake practice round, mandatory **Stake at Risk** disclosure (`NGN` + `USDC`), client-side photo compression + SHA-256 hashing, and deadline-aware `OfflineQueueManager`.
  - Buyer dashboard with shared Zod validation, MapLibre market coverage config, Recharts price trends, API keys, and webhooks.
  - i18n catalogs for `en`, `fr`, `ha`, `yo`, `ig`, `pcm`, `tw` with safe English fallback.
- **Evidence-Check Service, Collusion Analytics & Economic Simulator:**
  - `services/evidence-check` (Python FastAPI): EXIF extraction, 64-bit `dHash` duplicate detection, Haversine market geofence verification, and Shannon entropy tampering heuristics.
  - `analytics/` (Python pandas + NetworkX): Common funder graph clustering, commit timing correlation, and price agreement detection.
  - `simulations/agent_simulation.py` (`pnpm simulate:economics`): Monte-Carlo agent simulation writing [`docs/economic-simulation.md`](./docs/economic-simulation.md).
- **Integration & Operations (`scripts/`, `docs/`, `infra/`):**
  - `pnpm seed:demo` and `pnpm demo:e2e` cross-layer verification script.
  - Full-stack Docker Compose profile (`--profile full`) and 6 operational runbooks in `docs/runbooks/`.
