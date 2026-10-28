# Getting Started with MarketPulse Oracle

**Companion Specification:** `README.md` Section 14 (Getting started).

This guide walks a new contributor from a clean clone to running all smart contract tests, backend services, Python analytics, Playwright smoke tests, and the full end-to-end oracle loop (`pnpm demo:e2e`) locally with zero external credentials required.

---

## 1. Prerequisites

| Tool               | Tested Version                     | Verify Command           |
| ------------------ | ---------------------------------- | ------------------------ |
| **Rust & Cargo**   | `1.96.0` (or stable `1.80+`)       | `cargo --version`        |
| **Stellar CLI**    | `28.0.0`                           | `stellar --version`      |
| **Node.js**        | `v20+` LTS (`v24.13.0` tested)     | `node --version`         |
| **pnpm**           | `10.28.2`                          | `pnpm --version`         |
| **Python**         | `3.11+` (`3.12.3` tested)          | `python3 --version`      |
| **Docker Compose** | v2+ (optional for container stack) | `docker compose version` |

---

## 2. Clone & Install Dependencies

```bash
git clone https://github.com/ogaziedaniel80-droid/marketpulse-oracle.git
cd marketpulse-oracle

# 1. Copy environment template (uses safe local mocks by default)
cp .env.example .env

# 2. Install TypeScript monorepo dependencies
pnpm install
```

---

## 3. Build & Test Everything

```bash
# 1. Run all 75 Soroban Rust smart contract unit & property tests
cargo test --workspace

# 2. Build all TypeScript packages (shared, bindings, ui, api, worker, web)
pnpm build

# 3. Run all TypeScript unit & integration tests (shared, api, worker, web)
pnpm test

# 4. Run Python Evidence-Check Service & Collusion Analytics tests
(cd services/evidence-check && pytest)
(cd analytics && pytest)

# 5. Run Playwright E2E browser smoke tests (Reporter happy path, Offline->Online queue, Buyer flow)
pnpm --filter web test:e2e
```

---

## 4. Seed Demo Data, Run End-to-End Demo & Economic Simulation

```bash
# 1. Seed 5 demo reporters, 3 Abuja pilot markets, and EXIF-stripped mock evidence
pnpm seed:demo

# 2. Run the full end-to-end oracle lifecycle (README §14.8):
#    create request -> enroll 5 reporters -> commit & reveal (1 outlier, 1 non-revealer)
#    -> resolve weighted median -> verify in API, Worker Indexer, and Web Dashboard
pnpm demo:e2e

# 3. Run the Monte-Carlo economic simulation and regenerate docs/economic-simulation.md
pnpm simulate:economics
```

---

## 5. Optional: Start Local Docker Infrastructure

To run PostgreSQL/PostGIS, Redis, and MinIO (or the full 7-container stack via [ADR 0003](./adr/0003-full-stack-docker-profile.md)):

```bash
# Backing services only (Postgres, Redis, MinIO)
docker compose -f infra/docker/compose.dev.yml up -d
pnpm db:migrate

# Or bring up the entire stack (Postgres, Redis, MinIO, API, Worker, Web, Evidence-Check)
docker compose -f infra/docker/compose.dev.yml --profile full up -d
```
