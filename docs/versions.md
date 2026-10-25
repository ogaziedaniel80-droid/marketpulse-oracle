# Dependency & Tooling Version Log

**Record Date:** 2026-10-25

Per project engineering rules, all tooling and dependencies are pinned to exact versions to ensure reproducible builds across development, CI, and production.

---

## 1. Toolchain & Runtime Versions

| Tool | Version | Purpose |
|---|---|---|
| **Rustc** | `1.96.0` (ac68faa20 2026-05-25) | Compiler for smart contracts |
| **Cargo** | `1.96.0` | Rust package manager |
| **Stellar CLI** | `28.0.0` (300aaf69ab100536678bdb641428b06f06b318ea) | Contract building, deployment, bindings generation |
| **Stellar XDR** | `28.0.0` | XDR protocol definitions |
| **Soroban SDK** | `28.0.0` | Smart contract SDK and test utilities |
| **Rust Wasm Target** | `wasm32-unknown-unknown`, `wasm32v1-none` | WebAssembly compilation targets |
| **Node.js** | `v24.13.0` (tested with `20.x` LTS baseline) | JavaScript / TypeScript runtime |
| **pnpm** | `10.28.2` | Monorepo package manager |
| **Turborepo** | `^2.3.0` | Monorepo build and task pipeline |
| **TypeScript** | `^5.6.3` | Typechecker |

---

## 2. Docker & Local Infrastructure Images

| Service | Image | Purpose |
|---|---|---|
| **PostgreSQL / PostGIS** | `postgis/postgis:16-3.4` | Relational storage & spatial indexing |
| **Redis** | `redis:7-alpine` | Task queues, rate limiting, and cache |
| **MinIO** | `minio/minio:latest` | S3-compatible evidence blob store |

---

## 3. Contract Wasm Artifact Sizes

*Wasm sizes compiled via `stellar contract build` in release profile:*

| Contract | Wasm Size (bytes) | Status |
|---|---|---|
| `marketpulse_shared` | *(library crate)* | N/A |
| `marketpulse_registry` | TBD (Recorded after build) | In Development |
| `marketpulse_request_board` | TBD (Recorded after build) | In Development |
| `marketpulse_report_engine` | TBD (Recorded after build) | Scaffolded |
| `marketpulse_disputes` | TBD (Recorded after build) | Scaffolded |
| `marketpulse_oracle_feed` | TBD (Recorded after build) | Scaffolded |
