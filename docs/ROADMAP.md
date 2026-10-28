# MarketPulse Oracle: Technical Roadmap & Sprint Completion Status

**Companion Specification:** `README.md` Section 24 (Roadmap) & [`Plan.md`](../Plan.md).  
**Current Release:** `v0.1.0-alpha` (Testnet Pre-Release)

---

## 1. Phase Alignment (`README.md` §24 & `Plan.md`)

| Phase                                      | Target Window | Core Deliverables                                                                                                                                                  | `v0.1.0-alpha` Status                                                                    |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Phase 0: Discovery & Foundations**       | Weeks 1–3     | Monorepo, data specs (`RICE50`, `TOMATO`), legal scoping, ADRs, PostgreSQL/PostGIS schema                                                                          | **Codebase Foundations Complete** (Live buyer LOIs & external counsel pending field ops) |
| **Phase 1: MVP Build**                     | Weeks 4–9     | `Registry`, `RequestBoard`, `ReportEngine`, `OracleFeed`, PWA with offline queue, Fastify API, Worker indexer, `pnpm demo:e2e`, economic simulation                | **Complete (Testnet / Local Mock Loop Verified)**                                        |
| **Phase 2: Pilot**                         | Weeks 10–19   | 30–50 field reporters in Abuja (Wuse, Garki, Utako), daily `RICE50` & `TOMATO` requests, 5–10% paid field audits                                                   | **Ready for Field Pilot Kickoff**                                                        |
| **Phase 3: Trust Layer & Hardening**       | Weeks 20–28   | `Disputes` contract with multi-party seed, `services/evidence-check` (EXIF, dHash, geofence, entropy), `analytics/` (NetworkX clustering), admin panel, audit prep | **Software Modules Complete** (External audit engagement pending)                        |
| **Phase 4: Expansion & Mainnet Readiness** | Weeks 29–40   | Enable second-wave types (`POWER`, `ROAD`, `LPG`), USSD gateway, anchor cash-out, audit closure, bug bounty                                                        | **Planned** (USSD custody design note in `docs/ussd-custody.md`)                         |
| **Phase 5: Integrations & Scale**          | Weeks 41+     | Parametric insurance consumer integrations, francophone West Africa (`fr`, `XOF`), public data portal                                                              | **Planned**                                                                              |

---

## 2. What the 7-Day Engineering Sprint Completed

- **Day 1–3 (Smart Contracts & Benchmarks):** Implemented and tested all 5 Soroban contracts (`Registry`, `RequestBoard`, `ReportEngine`, `Disputes`, `OracleFeed`) + `contracts/shared` with 75 unit and `proptest` property tests, resource benchmarks at `max_reports = 15`, and testnet deployment/bindings scripts.
- **Day 4–5 (Database, Services, API & Worker):** Implemented 15-table PostgreSQL/PostGIS schema (`001_initial_schema.up.sql`), external service interfaces and local mocks, OpenAPI 3.1 + Fastify REST API (`apps/api`), and Stellar RPC event indexer + BullMQ worker + Prometheus metrics (`apps/worker`).
- **Day 6 (PWA, Evidence Service, Analytics & Economic Simulation):** Implemented the offline-first PWA (`apps/web`) with 7 locales (`en`, `fr`, `ha`, `yo`, `ig`, `pcm`, `tw`), Playwright E2E smoke tests, FastAPI evidence verification service (`services/evidence-check`), NetworkX/pandas collusion analytics (`analytics/`), and Monte-Carlo economic simulator (`simulations/agent_simulation.py` -> `docs/economic-simulation.md`).
- **Day 7 (Integration, Documentation, Runbooks & `v0.1.0-alpha` Release):** Wired `pnpm seed:demo`, `pnpm demo:e2e`, full-stack Docker Compose profile (`ADR 0003`), operational runbooks (`docs/runbooks/`), audit prep package (`docs/audit-prep.md`), and `CHANGELOG.md`.
