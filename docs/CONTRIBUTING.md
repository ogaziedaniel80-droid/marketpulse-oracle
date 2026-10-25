# Contributing to MarketPulse Oracle

Thank you for your interest in contributing to MarketPulse Oracle! MarketPulse is an open-source, stake-backed local data network built on Stellar Soroban to make real-time informal market data trustworthy and available across West Africa.

---

## 1. Code of Conduct

All contributors are expected to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## 2. Source of Truth and Guardrails

Before contributing, read `README.md` and `Plan.md` thoroughly.

### Product Guardrails
1. **Core Mechanism:** Requests with escrowed USDC bounty -> commit (`sha256(value || salt)`) with stake -> reveal with evidence hash -> reputation-weighted median -> payouts and gentle slashing -> challenge window -> finalised observation via `OracleFeed`.
2. **Slashing Policies:** Outlier slashing is gentle (20-30% default). Non-reveal slashing is heavier (50-100%). Full 100% slashing and reputation reset is reserved only for provable fraud.
3. **Privacy First:** Never store personal data on-chain. Store only cryptographic hashes, coarse market-level geohashes, and aggregated medians.
4. **Relayer Fee Sponsorship:** Reporters never need XLM. Gas/tx fees are sponsored via relayer fee-bumps.
5. **Randomness:** Never rely on `env.prng()` alone for anything of financial value.
6. **CPU Budget:** Reports per request are strictly capped (`max_reports`, default 15) for Soroban compute limits.

---

## 3. Architecture Decision Records (ADRs)

Do not add unapproved features or alter public contract interfaces arbitrarily. If a change or architecture deviation is necessary:
1. Open a proposal under `docs/adr/NNNN-<title>.md` using `docs/adr/0000-template.md`.
2. Seek approval before proceeding with implementation.

---

## 4. Development Workflow

- **Branching:** Short-lived feature branches branched from `main`.
- **Commits:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
  - `feat:` New features
  - `fix:` Bug fixes
  - `docs:` Documentation only
  - `test:` Adding or refactoring tests
  - `chore:` Maintenance, dependencies, tooling
- **Formatting and Linting:**
  ```bash
  cargo fmt --check
  cargo clippy --all-targets --all-features -- -D warnings
  pnpm lint
  pnpm typecheck
  ```
- **Testing:**
  ```bash
  cargo test --workspace
  pnpm test
  ```
- **Contract Changes:** Every change to `contracts/` requires:
  - Updated unit and property tests (`proptest`).
  - Regenerated TypeScript bindings (`pnpm bindings:generate`).
  - A documented entry in `docs/contracts-changelog.md`.
  - Re-verified resource/budget footprints.

---

## 5. Responsible Security Disclosure

Please do **NOT** open public GitHub issues for security vulnerabilities.
Consult [docs/SECURITY.md](./SECURITY.md) for reporting procedures.
