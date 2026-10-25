# Dependency & Tooling Version Log

**Record Date:** 2026-10-25

Per project engineering rules, all tooling and dependencies are pinned to exact versions to ensure reproducible builds across development, CI, and production.

---

## 1. Toolchain & Runtime Versions

| Tool                 | Version                                             | Purpose                                            |
| -------------------- | --------------------------------------------------- | -------------------------------------------------- |
| **Rustc**            | `1.96.0` (ac68faa20 2026-05-25)                     | Compiler for smart contracts                       |
| **Cargo**            | `1.96.0`                                            | Rust package manager                               |
| **Stellar CLI**      | `28.0.0` (300aaf69ab100536678bdb641428b06f06b318ea) | Contract building, deployment, bindings generation |
| **Stellar XDR**      | `28.0.0`                                            | XDR protocol definitions                           |
| **Soroban SDK**      | `28.0.0`                                            | Smart contract SDK and test utilities              |
| **Rust Wasm Target** | `wasm32-unknown-unknown`, `wasm32v1-none`           | WebAssembly compilation targets                    |
| **Node.js**          | `v24.13.0` (tested with `20.x` LTS baseline)        | JavaScript / TypeScript runtime                    |
| **pnpm**             | `10.28.2`                                           | Monorepo package manager                           |
| **Turborepo**        | `^2.11.10`                                          | Monorepo build and task pipeline                   |
| **TypeScript**       | `5.9.3`                                             | Typechecker                                        |
| **Zod**              | `^3.23.8`                                           | Schema validation                                  |
| **Proptest**         | `1.12.0`                                            | Property-based testing                             |

---

## 2. Docker & Local Infrastructure Images

| Service                  | Image                    | Purpose                               |
| ------------------------ | ------------------------ | ------------------------------------- |
| **PostgreSQL / PostGIS** | `postgis/postgis:16-3.4` | Relational storage & spatial indexing |
| **Redis**                | `redis:7-alpine`         | Task queues, rate limiting, and cache |
| **MinIO**                | `minio/minio:latest`     | S3-compatible evidence blob store     |

---

## 3. Contract Wasm Artifact Sizes

_Wasm sizes compiled via `stellar contract build` in release profile (`wasm32v1-none` target):_

| Contract                    | Wasm Size (Optimized)      | Original Size | SHA-256 Wasm Hash                                                  | Status                  |
| --------------------------- | -------------------------- | ------------- | ------------------------------------------------------------------ | ----------------------- |
| `marketpulse_shared`        | _(library crate)_          | N/A           | N/A                                                                | Production Types & Math |
| `marketpulse_registry`      | **16,480 bytes** (16.1 KB) | 19,567 bytes  | `1ab51890ed23c378c0035271064062258b156012deb72261b8a4b59e415b8e79` | Implemented & Tested    |
| `marketpulse_request_board` | **14,646 bytes** (14.3 KB) | 16,448 bytes  | `1d18d92248861902f76f478533b1b9d3e7eebaacdc08ef068b53478ecf44cfb7` | Implemented & Tested    |
| `marketpulse_report_engine` | 432 bytes                  | 451 bytes     | `f120df5b7be813ce4ca9f92ca3a7dacf2c061512a73ea54100a657069afa2f2e` | Scaffolded (Wave 1)     |
| `marketpulse_disputes`      | 432 bytes                  | 451 bytes     | `f120df5b7be813ce4ca9f92ca3a7dacf2c061512a73ea54100a657069afa2f2e` | Scaffolded (Wave 1)     |
| `marketpulse_oracle_feed`   | 432 bytes                  | 451 bytes     | `f120df5b7be813ce4ca9f92ca3a7dacf2c061512a73ea54100a657069afa2f2e` | Scaffolded (Wave 1)     |
