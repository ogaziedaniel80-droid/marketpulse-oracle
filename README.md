# MarketPulse Oracle

> MarketPulse Oracle is a crowd-sourced, stake-backed local data network for West Africa, built on Stellar's Soroban smart contracts. People get paid to report verifiable facts such as staple prices, fuel availability, road conditions, and power outages. Reports confirmed by other reporters earn rewards. Wrong or spammy reports lose stake.

![status](https://img.shields.io/badge/status-pre--alpha-orange)
![network](https://img.shields.io/badge/network-Stellar%20Testnet-blue)
![contracts](https://img.shields.io/badge/contracts-Soroban%20(Rust)-black)
![license](https://img.shields.io/badge/license-Apache--2.0-green)

---

## Table of contents

1. [Why this exists](#1-why-this-exists)
2. [What it does](#2-what-it-does)
3. [Who it is for](#3-who-it-is-for)
4. [How it works](#4-how-it-works)
5. [Architecture](#5-architecture)
6. [Repository layout](#6-repository-layout)
7. [Tech stack](#7-tech-stack)
8. [Smart contract design](#8-smart-contract-design)
9. [Data types for West Africa](#9-data-types-for-west-africa)
10. [Economics and parameters](#10-economics-and-parameters)
11. [Anti-sybil and anti-collusion design](#11-anti-sybil-and-anti-collusion-design)
12. [Reporter experience and onboarding](#12-reporter-experience-and-onboarding)
13. [Security model and audit checklist](#13-security-model-and-audit-checklist)
14. [Getting started](#14-getting-started)
15. [Configuration reference](#15-configuration-reference)
16. [Development workflow](#16-development-workflow)
17. [Testing strategy](#17-testing-strategy)
18. [Deployment](#18-deployment)
19. [API reference](#19-api-reference)
20. [Consuming the oracle on-chain](#20-consuming-the-oracle-on-chain)
21. [Parametric insurance integration](#21-parametric-insurance-integration)
22. [Legal, compliance, and privacy](#22-legal-compliance-and-privacy)
23. [Observability and operations](#23-observability-and-operations)
24. [Roadmap](#24-roadmap)
25. [Pilot plan](#25-pilot-plan)
26. [Contributing](#26-contributing)
27. [FAQ](#27-faq)
28. [Glossary](#28-glossary)
29. [License](#29-license)

---

## 1. Why this exists

West Africa has large, fast-moving informal markets and very little machine-readable, trustworthy, real-time data about them.

- A trader in Kano does not know the current price of tomatoes in Ibadan until a truck has already left.
- A logistics firm cannot tell whether fuel is available along a route until its drivers are stuck in a queue.
- A farmer taking out crop insurance has to trust a model built on data from a weather station that may be hundreds of kilometres away.
- Cooperatives and NGOs run price surveys that are slow, expensive, and stale by the time they are published.

Official statistics exist (national statistics bureaus, FEWS NET, WFP VAM, and others) but are typically weekly, monthly, or lagged, and coverage of small markets is thin.

MarketPulse Oracle turns the people who are already standing in those markets into a paid, accountable data network. Economic incentives (stake, rewards, slashing) and layered verification make the data trustworthy enough for buyers, and for other smart contracts, to rely on.

## 2. What it does

- **Requests.** A buyer posts a data request with a bounty, for example "price of a 50 kg bag of local rice at Mile 12 Market, Lagos, within 24 hours."
- **Reports.** Reporters near that location stake a small amount and submit a sealed (committed) report.
- **Reveal and consensus.** After the commit window, reports are revealed. The contract computes a reputation-weighted aggregate and pays those within tolerance.
- **Slashing.** Outliers, non-revealers, and provably fraudulent reports lose stake.
- **Disputes.** Anyone can challenge a result by posting a bond. An audit panel decides.
- **Feeds.** Finalised observations are readable on-chain by other contracts and off-chain through an API and dashboard.
- **Rewards and cash-out.** Reporters are paid in USDC on Stellar and can cash out through local anchors or mobile money rails where available.

## 3. Who it is for

| Audience | What they get |
|---|---|
| **Traders and aggregators** | Near-real-time staple prices across markets for buying, selling, and routing decisions |
| **Logistics and fleet operators** | Fuel availability and road condition reports along corridors |
| **Parametric insurers and cooperatives** | An on-chain trigger source for price, supply, or disruption payouts |
| **NGOs, researchers, and governments** | Granular, timestamped, geotagged market data with audit trails |
| **Reporters** | Small, frequent payments for reporting what they already see |
| **Developers** | A standard on-chain interface (`OracleFeed`) to read local data |

## 4. How it works

### 4.1 Request lifecycle

```
 Created ─▶ Committing ─▶ Revealing ─▶ Resolving ─▶ Challenge window ─▶ Finalised
                │              │             │               │
                │              │             │               └─▶ Disputed ─▶ Ruled ─▶ Finalised
                └─ expired / under-subscribed ─▶ Cancelled (bounty refunded)
```

1. **Create.** A buyer calls `create_request`, escrowing the bounty in USDC with parameters: data type, geohash, tolerance, minimum stake, deadlines, and minimum reports.
2. **Assignment.** Eligible reporters (active, geographically plausible, sufficient reputation) are drawn from the pool. Reporters cannot hand-pick requests.
3. **Commit.** Each assigned reporter submits `sha256(value || salt)` and stakes. Commitments prevent copying earlier reports.
4. **Reveal.** Reporters reveal `value`, `salt`, and an evidence hash (photo or receipt stored off-chain, hash on-chain).
5. **Resolve.** The contract computes the reputation-weighted median of valid reveals. Reports within tolerance share the bounty and recover stake plus a bonus drawn from slashed stakes. Outliers are gently slashed, and non-revealers are slashed more.
6. **Challenge window.** Anyone can post a bond to dispute. Disputes go to a randomly selected audit panel (a trusted fallback panel in v1).
7. **Finalise.** The observation is written to `OracleFeed`. Payouts become claimable.

### 4.2 Why a median, and why gentle slashing

Informal market prices legitimately vary from stall to stall. A weighted median is robust to a minority of bad or noisy reports. Because honest variance exists, outliers lose only a portion of their stake (default 20 to 30 percent). Full slashing is reserved for provable fraud: failed audits, duplicate or reused evidence, or proven collusion.

### 4.3 The key limitation, stated plainly

A median of colluding reporters is still wrong. Staking raises the cost of lying, and random assignment, reputation, and identity cost make collusion harder, but the strongest defence is **paid ground-truth audits**: a small percentage of reports are checked by trusted field agents. See [section 11](#11-anti-sybil-and-anti-collusion-design).

## 5. Architecture

```
Reporter PWA / USSD ──passkey sign──▶ Relayer (fee sponsor) ──▶ Stellar RPC ──▶ Soroban contracts
      │                                                                              │
      ├─ evidence upload ─▶ API ─▶ R2 / IPFS + evidence-check service                │ events
      │                                                                              ▼
Buyer dashboard / API ◀──── Postgres (+PostGIS) ◀──── Indexer worker ◀───────────────┘
                                   ▲
                        Queue workers (resolution triggers,
                        audit scheduling, clustering, notifications)
```

### Components

| Component | Responsibility |
|---|---|
| **Soroban contracts** | Source of truth for stakes, commitments, reveals, payouts, reputation, disputes, and finalised observations |
| **Web app (PWA)** | Mobile-first reporter and buyer interface, offline queue, multilingual |
| **USSD/SMS gateway** | Fallback reporting channel for feature phones and low connectivity |
| **API** | Auth, evidence upload, buyer API, webhooks, admin endpoints |
| **Worker** | Indexer, resolution triggers, assignment, audit scheduling, notifications |
| **Evidence-check service** | EXIF parsing, perceptual hashing, duplicate detection, geo-plausibility |
| **Analytics jobs** | Wallet clustering, timing correlation, funding-source graph analysis |
| **Relayer** | Sponsors transaction fees so reporters never need XLM |

## 6. Repository layout

```
marketpulse-oracle/
├── contracts/
│   ├── registry/              # Reporter enrollment, reputation, status
│   ├── request-board/         # Request creation, escrow, schedules, expiry
│   ├── report-engine/         # Commit, reveal, aggregation, payout, slashing
│   ├── disputes/              # Bonds, panel selection, rulings
│   ├── oracle-feed/           # Read-only consumer interface
│   └── shared/                # Shared types, errors, math helpers
├── packages/
│   ├── bindings/              # Generated TypeScript contract clients
│   ├── shared/                # Shared TS types, validation (zod), constants
│   └── ui/                    # Shared React components
├── apps/
│   ├── web/                   # Next.js PWA (reporter + buyer dashboard)
│   ├── api/                   # Fastify/NestJS backend
│   └── worker/                # Indexer, queues, schedulers
├── services/
│   └── evidence-check/        # Python: EXIF, pHash, duplicate detection
├── analytics/                 # Python notebooks and jobs: clustering, correlation
├── infra/
│   ├── docker/                # Dockerfiles and compose files
│   ├── terraform/             # Optional cloud infrastructure
│   └── relayer/               # Fee-sponsorship relayer config
├── scripts/                   # Deploy, seed, bindings generation, simulations
├── simulations/               # Economic and attack simulations
├── docs/                      # Specs, ADRs, threat model, runbooks
├── .github/workflows/         # CI
├── Cargo.toml                 # Rust workspace
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
├── LICENSE
└── README.md
```

## 7. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Smart contracts | Rust, `soroban-sdk`, Stellar CLI | Unit tests with `testutils`, integration tests on local and testnet |
| Contract bindings | `stellar contract bindings typescript` | Typed clients for web, API, worker |
| Chain access | `@stellar/stellar-sdk`, Stellar RPC | Simulate and submit Soroban transactions |
| Wallets | Passkey smart wallets (e.g. `passkey-kit`) for reporters; Stellar Wallets Kit for buyers | Passkeys avoid seed phrases |
| Fee sponsorship | Relayer wrapping transactions in fee-bumps | Reporters never hold XLM. Verify current relayer options |
| Frontend | Next.js, React, TypeScript, Tailwind, PWA | Offline-first, low bandwidth, i18n |
| Backend | Node.js with Fastify (or NestJS) | REST API, webhooks |
| Database | PostgreSQL + PostGIS | Off-chain mirror and geo queries |
| Queue | Redis + BullMQ | Jobs and scheduling |
| Indexer | Worker polling Stellar RPC `getEvents` into Postgres | RPC retains limited event history, so ingest continuously |
| Evidence storage | Cloudflare R2 or S3, plus IPFS pinning | Hash client-side, store hash on-chain |
| Evidence checks | Python (Pillow, imagehash, exifread) | Duplicate and tamper signals |
| Analytics | Python (pandas, networkx) and SQL | Clustering and correlation |
| SMS/USSD | Africa's Talking (or Twilio for SMS) | Coverage across Nigeria, Ghana, and francophone West Africa; verify per country |
| Fiat billing | Paystack or Flutterwave (buyers), Stripe where applicable | Buyers pay in local currency, bounties funded in USDC |
| Maps and charts | MapLibre GL, Recharts | Buyer dashboard |
| Infra | Docker, GitHub Actions, Fly.io/Railway/AWS, Sentry, Grafana, Prometheus | Separate testnet and mainnet environments |
| Monorepo | pnpm workspaces + Turborepo; Cargo workspace for Rust | |

**Version policy.** Soroban SDK, protocol features, and wallet tooling change quickly. Pin exact versions in `Cargo.toml` and `package.json`, and check the official Stellar developer docs before upgrading.

## 8. Smart contract design

### 8.1 Contracts

| Contract | Responsibility |
|---|---|
| `Registry` | Reporter enrollment, reputation score, tier, status (active, suspended, banned), vouching relationships |
| `RequestBoard` | Request creation, bounty escrow, scheduling, expiry, cancellation and refund |
| `ReportEngine` | Commit, reveal, weighted aggregation, payout and slashing, claim |
| `Disputes` | Bonds, audit panel selection, rulings, fraud flags |
| `OracleFeed` | Read-only interface: latest value, history, confidence, freshness |

Keeping these separate keeps each contract small (important under Soroban resource limits) and lets you upgrade or replace modules independently.

### 8.2 Core types

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Open,
    Revealing,
    Resolving,
    Challengeable,
    Disputed,
    Finalised,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Request {
    pub id: u64,
    pub requester: Address,
    pub data_type: Symbol,          // e.g. symbol_short!("RICE50")
    pub geohash: BytesN<8>,         // coarse market-level geohash
    pub bounty: i128,               // in token base units
    pub token: Address,             // USDC SAC address
    pub min_stake: i128,
    pub tolerance_bps: u32,         // e.g. 800 = 8%
    pub commit_deadline: u64,       // ledger timestamp
    pub reveal_deadline: u64,
    pub challenge_window: u64,      // seconds after resolve
    pub min_reports: u32,
    pub max_reports: u32,           // bounded for CPU budget
    pub status: RequestStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct Report {
    pub reporter: Address,
    pub commitment: BytesN<32>,     // sha256(value || salt)
    pub value: Option<i128>,        // set at reveal, fixed-point
    pub evidence_hash: Option<BytesN<32>>,
    pub stake: i128,
    pub weight_bps: u32,            // snapshot of reputation weight at commit
}

#[contracttype]
#[derive(Clone)]
pub struct Observation {
    pub request_id: u64,
    pub data_type: Symbol,
    pub geohash: BytesN<8>,
    pub value: i128,                // weighted median
    pub confidence_bps: u32,        // agreement and report-count based
    pub n_reports: u32,
    pub finalised_at: u64,
}
```

### 8.3 Public interface (sketch)

```rust
// RequestBoard
fn create_request(env: Env, requester: Address, params: RequestParams) -> u64;
fn cancel_request(env: Env, requester: Address, request_id: u64);

// ReportEngine
fn commit(env: Env, reporter: Address, request_id: u64, commitment: BytesN<32>, stake: i128);
fn reveal(env: Env, reporter: Address, request_id: u64, value: i128, salt: BytesN<32>, evidence_hash: BytesN<32>);
fn resolve(env: Env, request_id: u64);          // permissionless after reveal deadline
fn claim(env: Env, reporter: Address, request_id: u64) -> i128;

// Disputes
fn challenge(env: Env, challenger: Address, request_id: u64, bond: i128, reason: Symbol);
fn rule(env: Env, panel_member: Address, request_id: u64, upheld: bool);

// Registry
fn enroll(env: Env, reporter: Address, attestation: BytesN<32>);
fn reputation(env: Env, reporter: Address) -> ReputationInfo;

// OracleFeed
fn get_latest(env: Env, data_type: Symbol, geohash: BytesN<8>) -> Option<Observation>;
fn get_history(env: Env, data_type: Symbol, geohash: BytesN<8>, limit: u32) -> Vec<Observation>;
```

### 8.4 Invariants (tested with property-based tests)

- Total tokens held by the contract always equal escrowed bounties plus staked amounts plus bonds, minus claimed payouts.
- No reporter can reveal a value that does not match the commitment.
- No reporter can commit twice to the same request.
- Resolution is idempotent and can only happen once per request.
- Slashed funds are fully distributed (rewards, protocol fee, treasury) with no rounding leakage beyond a defined dust sink.
- A request cannot be cancelled once any commitment has been made, except by the contract's under-subscription rule.
- Reputation changes are bounded per request.

### 8.5 Soroban-specific notes

- **Storage.** Use temporary storage for in-flight commitments and persistent storage for reputation and finalised observations. Plan TTL extensions explicitly, and have the worker extend TTLs for active data.
- **Resource budget.** Weighted median is O(n log n). Cap `max_reports` (default 15) and sort in a bounded loop. Benchmark with the simulation budget before choosing the cap.
- **Randomness.** Do not rely on `env.prng()` alone for anything of value. Use a commit-reveal seed contributed by multiple parties (or an external beacon) for panel selection and assignment.
- **Tokens.** USDC is handled through its Stellar Asset Contract (SAC). Reporters need a trustline (or smart wallet token balance) for the asset.
- **Authorisation.** Every state-changing function calls `require_auth()` on the acting address.
- **Time.** Use `env.ledger().timestamp()`. Ledgers close roughly every 5 seconds.
- **Upgrades.** Use a time-locked, multisig-controlled upgrade path. Document it, and consider making `OracleFeed` immutable once stable so integrators can trust it.

## 9. Data types for West Africa

### 9.1 Launch data types (MVP)

| Code | Description | Value type | Region focus |
|---|---|---|---|
| `RICE50` | Price of a 50 kg bag of local or imported rice | Fixed-point local currency | Nigeria, Ghana, Senegal, Côte d'Ivoire |
| `GARRI` | Price per standard measure of garri | Fixed-point local currency | Nigeria, Ghana |
| `MAIZE` | Price per standard measure of maize | Fixed-point local currency | Northern Nigeria, Ghana, Burkina Faso |
| `TOMATO` | Price of a standard basket or crate of tomatoes | Fixed-point local currency | Nigeria (Lagos, Kano, Ibadan) |
| `FUEL_PMS` | Petrol availability and pump price at a station | Enum + price | Nigeria, Ghana |
| `FUEL_DSL` | Diesel availability and price | Enum + price | Nigeria, Ghana |

### 9.2 Second wave

| Code | Description |
|---|---|
| `POWER` | Grid outage status at a location (on, off, intermittent) with duration |
| `ROAD` | Road status on a named corridor (open, slow, blocked, flooded) |
| `LPG` | Cooking gas availability and price |
| `FX_PARALLEL` | Parallel market exchange rate observations (handle carefully; see [section 22](#22-legal-compliance-and-privacy)) |
| `CHECKPOINT` | Informal delay or queue time at a border or checkpoint |

### 9.3 Standardisation matters

"A bag of rice" is not one thing. Every data type must define:

- **Unit** (for example 50 kg bag, "derica" measure, crate).
- **Grade or variety** (for example local parboiled vs. imported).
- **Location granularity** (market-level geohash, not individual stall).
- **Currency and fixed-point decimals.**
- **Tolerance band** (default per type, overridable per request).
- **Evidence rule** (for example photo of item with visible price tag, or receipt).

These definitions live in `packages/shared/src/datatypes/` and are mirrored on-chain by a registry of approved type codes.

### 9.4 Currencies

Values are stored in the local currency's minor unit as fixed-point integers (NGN, GHS, XOF, GMD, and so on), plus a currency code. A separate `FX` feed (or a trusted reference source) can be used to normalise to USD for cross-border comparisons. Do not assume a single exchange rate. Where parallel and official rates diverge, store the one that matches what the reporter actually paid.

### 9.5 Languages

The PWA and USSD flows should support, at minimum: English, French, Hausa, Yoruba, Igbo, Nigerian Pidgin, and Twi. Use ICU-based i18n with translation files in `apps/web/locales/`.

## 10. Economics and parameters

All values are **starting points for pilot tuning**. Express amounts in USDC; show local-currency equivalents in the UI.

| Parameter | Default | Rationale |
|---|---|---|
| Min stake (new reporter) | 0.25 USDC | Low enough to join, high enough to deter drive-by spam |
| Stake cap (new reporter) | 1 USDC | Caps losses and influence for unproven wallets |
| Bounty per request | 3 to 10 USDC | Split among accepted reports |
| Reports per request | 5 to 15 | Balances cost, consensus quality, and CPU budget |
| Tolerance band | 8% (staples), exact match (categorical) | Stall-to-stall variance |
| Outlier slash | 20 to 30% of stake | Gentle, since honest variance exists |
| Non-reveal slash | 50 to 100% of stake | Prevents griefing after commit |
| Fraud slash | 100% of stake, plus reputation reset | Reserved for proven fraud |
| Challenge bond | 5x average stake | Deters frivolous disputes |
| Audit rate | 3 to 10% of requests | Ground-truth anchor |
| Protocol fee | 5 to 10% of bounty | Funds audits, infrastructure, relayer |
| Reputation gain / loss | Slow up, fast down (for example +1 per confirmed, -5 per outlier) | Makes sybil farming costly |

### Reward split (per request)

```
bounty ─┬─ protocol fee (5-10%) ─────▶ treasury (funds audits, relayer, ops)
        └─ remainder ────────────────▶ accepted reporters, pro rata by weight
slashed stakes ─┬─ 50% ─▶ accepted reporters (bonus)
                ├─ 30% ─▶ audit fund
                └─ 20% ─▶ treasury
```

### Why economics must be simulated first

Before mainnet, run the simulations in `simulations/` to test:

- Profit of honest reporting vs. lazy copying vs. random guessing.
- Cost for an attacker to control the median at different sybil counts.
- Effect of audit rate on expected profit from collusion.
- Reporter retention at different bounty levels (the real constraint is whether people stay).

## 11. Anti-sybil and anti-collusion design

Staking alone does not prevent sybils: one actor can run 50 wallets. Defences are layered.

| Layer | Mechanism | Where |
|---|---|---|
| **Identity cost** | Phone verification (OTP), device attestation, community vouching by staked agents | Off-chain, attested on-chain |
| **Random assignment** | Reporters cannot choose requests; drawn from eligible pool using a multi-party seed | On-chain |
| **Commit-reveal** | Prevents copying of earlier reports | On-chain |
| **Reputation weighting** | New wallets have low weight and caps; reputation builds slowly, drops fast | On-chain |
| **Geo plausibility** | Geohash vs. reporter's recent locations and request region | Off-chain flags, on-chain disputes |
| **Evidence checks** | EXIF, perceptual hash duplicate detection, reuse across reporters | Off-chain service |
| **Correlation detection** | Wallets that always agree, share timing, funding sources, or devices | Indexer analytics |
| **Random paid audits** | Field agents or trusted sources verify a sample | Hybrid |
| **Vouching liability** | Vouchers lose part of their stake when vouched reporters are slashed for fraud | On-chain |
| **Diversity requirement** | Require reports from several distinct reputation clusters or sub-areas | On-chain parameter |

### Known attack scenarios and mitigations

| Attack | Mitigation |
|---|---|
| Sybil swarm to control the median | Identity cost, caps on new-wallet weight, correlation detection |
| Colluding group reports false price (e.g. to trigger an insurance payout) | Random audits, required diversity, high-value requests use larger panels and delayed finality |
| Copying others after reveal begins | Commit-reveal |
| Griefing: commit and never reveal | Heavy non-reveal slash |
| Photo reuse or stock images | pHash duplicate detection, EXIF and timestamp checks |
| Bribery of reporters by an insurance beneficiary | Randomised assignment, anonymous assignment until commit, audit anchor |
| Spam requests to drain reporters | Minimum bounty, requester reputation |
| Frivolous disputes | Bond sized to deter, bond slashed if dispute is rejected |
| Admin key compromise | Multisig, time locks, KMS or HSM, minimal admin powers |
| Oracle manipulation of consuming contracts | Consumers should use freshness, confidence, and minimum-report checks and add their own delays |

## 12. Reporter experience and onboarding

Onboarding is the real sybil defence and the real growth constraint.

### 12.1 Onboarding flow

1. **Phone number and OTP** (SMS via Africa's Talking or similar).
2. **Passkey wallet creation** (biometric or device PIN; no seed phrase).
3. **Optional vouching** by a community agent (market association leaders, cooperative officers, trusted agents with stake at risk).
4. **Training task**: three practice requests with feedback and no stake.
5. **Tier 1 enrollment**: low stake cap, limited request types.
6. **Graduation** to higher tiers with reputation: bigger caps, higher weight, access to higher-value requests.

### 12.2 Channels

- **PWA** (primary): installable, offline queue, data-light, photo capture with client-side compression.
- **USSD/SMS** (fallback): numeric price reports with a short confirmation code. Evidence is weaker, so weight these reports lower or require a field agent. USSD session limits mean this needs a custodial or delegated-signing model; document the trust trade-off explicitly in `docs/ussd-custody.md`.
- **Agent mode**: a vouching agent can assist several reporters from one device, with every report still signed by the reporter's own credentials.

### 12.3 Getting paid

- Rewards accrue in USDC on Stellar.
- Cash-out options: Stellar anchors (SEP-24/SEP-6), local P2P or off-ramp partners, or mobile money integrations, depending on country. **Availability changes frequently; verify current anchors and regulations per country before promising anything to reporters.**
- Display balances in local currency and explain stake and slashing in plain language, in local languages, before the first stake.

### 12.4 UX principles

- Assume low-end Android devices and intermittent data.
- Show the exact stake at risk before every commit.
- Explain every slash with a reason code and a path to appeal.
- Never require the reporter to hold XLM. Fees are sponsored.

## 13. Security model and audit checklist

### Trust assumptions (v1)

- Stellar network and Soroban runtime are correct and live.
- The fallback arbiter (multisig) acts honestly during the early phase.
- Off-chain checks (evidence, geo) are advisory and feed disputes; they do not unilaterally slash.
- The relayer is not a custody risk because it only sponsors fees.

### Pre-mainnet checklist

- [ ] Independent smart contract audit (at least one reputable firm)
- [ ] Property-based tests for escrow and payout invariants
- [ ] Fuzzing for reveal, resolve, and claim paths
- [ ] Resource-budget benchmarks at `max_reports` and worst-case inputs
- [ ] TTL management tested (no expiry of active data)
- [ ] Admin key setup: multisig, hardware-backed keys, documented ceremony
- [ ] Upgrade path with time lock and public announcement
- [ ] Economic simulation reviewed against attack scenarios
- [ ] Bug bounty programme live before significant value is held
- [ ] Incident response runbook and pause mechanism tested
- [ ] Legal review in each launch country (see [section 22](#22-legal-compliance-and-privacy))
- [ ] Privacy review: no personal data on-chain

### Key management

- Admin and arbiter keys live in a KMS or HSM. Never commit keys or store them in `.env` files in production.
- Use separate keys per environment and per role (deployer, arbiter, treasury, relayer).

### Responsible disclosure

Report vulnerabilities privately to `security@<your-domain>` (set this up before public launch). Do not open public issues for security bugs.

## 14. Getting started

### 14.1 Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust | stable (see `rust-toolchain.toml`) | Contracts |
| `wasm32v1-none` or `wasm32-unknown-unknown` target | per current Soroban docs | Wasm build target |
| Stellar CLI | latest stable | Build, deploy, bindings |
| Node.js | 20 LTS or newer | Apps |
| pnpm | 9+ | Package management |
| Docker and Docker Compose | recent | Postgres, Redis, local services |
| Python | 3.11+ | Evidence service and analytics |

> Check the official Stellar developer documentation for the current Rust target name and CLI install command, as these have changed between releases.

### 14.2 Clone and install

```bash
git clone https://github.com/<your-org>/marketpulse-oracle.git
cd marketpulse-oracle

# JS/TS dependencies
pnpm install

# Rust dependencies are fetched on first build
cargo --version
stellar --version
```

### 14.3 Start local infrastructure

```bash
cp .env.example .env
docker compose -f infra/docker/compose.dev.yml up -d   # Postgres+PostGIS, Redis, MinIO (S3-compatible)
pnpm db:migrate
```

### 14.4 Build and test contracts

```bash
# Build all contracts
stellar contract build

# Unit tests
cargo test --workspace
```

### 14.5 Configure a testnet identity and deploy

```bash
# Create and fund a testnet identity
stellar keys generate deployer --network testnet --fund

# Deploy contracts (the script deploys, wires dependencies, and writes IDs to .env.local)
./scripts/deploy-testnet.sh
```

### 14.6 Generate TypeScript bindings

```bash
pnpm bindings:generate
# Under the hood, for each contract:
# stellar contract bindings typescript \
#   --network testnet \
#   --contract-id $REPORT_ENGINE_ID \
#   --output-dir packages/bindings/report-engine
```

### 14.7 Seed demo data and run the apps

```bash
pnpm seed:demo        # demo reporters, a sample request, mock evidence

pnpm dev              # runs web, api, worker, and evidence-check via Turborepo
```

| Service | Default URL |
|---|---|
| Web (PWA) | http://localhost:3000 |
| API | http://localhost:4000 |
| Evidence service | http://localhost:5000 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |
| MinIO console | http://localhost:9001 |

### 14.8 Run a full end-to-end demo

```bash
pnpm demo:e2e
```

This script creates a request, enrolls five demo reporters, runs commit and reveal (including one outlier and one non-revealer), resolves, and prints payouts and slashes.

## 15. Configuration reference

Copy `.env.example` to `.env`. Never commit real secrets.

```bash
# --- Network ---
STELLAR_NETWORK=testnet                     # testnet | mainnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# --- Contract IDs (written by deploy script) ---
REGISTRY_ID=
REQUEST_BOARD_ID=
REPORT_ENGINE_ID=
DISPUTES_ID=
ORACLE_FEED_ID=
USDC_SAC_ID=

# --- Keys (use KMS in production) ---
DEPLOYER_SECRET=
ARBITER_MULTISIG_ADDRESS=
RELAYER_URL=
RELAYER_API_KEY=

# --- Database / cache ---
DATABASE_URL=postgres://marketpulse:marketpulse@localhost:5432/marketpulse
REDIS_URL=redis://localhost:6379

# --- Storage ---
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=marketpulse-evidence
S3_ACCESS_KEY=
S3_SECRET_KEY=
IPFS_PINNING_PROVIDER=pinata
IPFS_PINNING_JWT=

# --- Messaging ---
AFRICASTALKING_API_KEY=
AFRICASTALKING_USERNAME=
SMS_SENDER_ID=MarketPulse

# --- Billing (buyers) ---
PAYSTACK_SECRET_KEY=
FLUTTERWAVE_SECRET_KEY=

# --- App ---
JWT_SECRET=
APP_BASE_URL=http://localhost:3000
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,fr,ha,yo,ig,pcm,tw

# --- Observability ---
SENTRY_DSN=
LOG_LEVEL=info
```

## 16. Development workflow

- **Branching:** trunk-based with short-lived feature branches; PRs require CI green and one review (two for contract changes).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- **Architecture decisions:** record in `docs/adr/NNNN-title.md`.
- **Contract changes:** every change requires updated tests, regenerated bindings, a note in `docs/contracts-changelog.md`, and a re-run of gas and resource benchmarks.
- **Linting and formatting:** `cargo fmt`, `cargo clippy -D warnings`, ESLint, Prettier, Ruff for Python.

Useful scripts:

```bash
pnpm lint              # all linters
pnpm typecheck         # TypeScript
pnpm test              # JS/TS tests
cargo test --workspace # contract tests
pnpm bindings:generate # regenerate TS clients after contract changes
pnpm simulate:economics # run economic simulations
```

## 17. Testing strategy

| Level | Tooling | What it covers |
|---|---|---|
| Contract unit tests | `soroban-sdk` testutils | Commit, reveal, aggregation, slashing, payouts, edge cases |
| Property-based tests | `proptest` | Escrow conservation, median correctness, no double-claim |
| Fuzzing | `cargo-fuzz` | Input validation, panics, arithmetic overflow |
| Integration tests | Local network or testnet | Cross-contract calls, token flows, events |
| API tests | Vitest + Supertest | Auth, evidence upload, buyer API |
| E2E tests | Playwright | Reporter and buyer flows in the PWA, including offline mode |
| Evidence service tests | Pytest with a labelled image set | Duplicate and tamper detection accuracy |
| Simulation | Python/Rust agent-based sims | Economic security under attack scenarios |
| Load tests | k6 | API and indexer throughput |

### Must-have contract test cases

- Commit after deadline is rejected; reveal before commit deadline is rejected.
- Reveal with a wrong salt fails.
- A single reporter cannot commit twice.
- Resolution with fewer than `min_reports` cancels and refunds.
- All reports identical, widely dispersed, and a single outlier.
- Weighted median with equal and unequal weights, including ties.
- Non-reveal slashing and redistribution with exact accounting.
- Dispute upheld and dispute rejected (bond handling).
- TTL extension and expiry behaviour.
- Maximum `max_reports` stays within the resource budget.

## 18. Deployment

### Environments

| Environment | Network | Purpose |
|---|---|---|
| `local` | Local standalone network | Development |
| `testnet` | Stellar testnet | Pilots, integration partners |
| `mainnet` | Stellar public network | Production, after audit |

### Contracts

```bash
# Build optimised wasm
stellar contract build

# Deploy (example)
stellar contract deploy \
  --wasm target/wasm32v1-none/release/report_engine.wasm \
  --source deployer \
  --network testnet
```

For mainnet: use a hardware-backed key or multisig for the deployer, deploy via a reviewed script, verify the deployed wasm hash against the audited build, and publish contract IDs and hashes in `docs/deployments.md`.

### Services

- Containerise `api`, `worker`, and `evidence-check` with Docker.
- Deploy to Fly.io, Railway, or AWS (ECS or Fargate). Managed Postgres with PostGIS and daily backups.
- Run **at least two** worker instances with leader election for the indexer, so a single failure does not stop resolution triggers.
- Put the API behind a CDN and rate limiter. Use WAF rules for the public buyer API.
- Run your own Stellar RPC node or use a reliable hosted provider with failover.

### Release process

1. Tag a release (`vX.Y.Z`).
2. CI builds contracts, runs all tests, and produces reproducible wasm hashes.
3. Deploy to testnet, run smoke and E2E tests.
4. Manual approval for mainnet; announce upgrades with a time lock.

## 19. API reference

Base URL: `/v1`. Auth: API key for buyers (`Authorization: Bearer <key>`), session token for reporters. Full OpenAPI spec lives in `apps/api/openapi.yaml`.

### Public data endpoints (buyers)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/observations` | Query finalised observations by `data_type`, `geohash` prefix, date range |
| GET | `/v1/observations/latest` | Latest observation for a data type and market |
| GET | `/v1/markets` | List supported markets with geohash and metadata |
| GET | `/v1/datatypes` | Supported data types, units, and tolerances |
| POST | `/v1/requests` | Create a data request (fiat-funded or USDC) |
| GET | `/v1/requests/:id` | Request status, report counts, resolution |
| POST | `/v1/webhooks` | Subscribe to events (observation finalised, request cancelled) |

Example:

```bash
curl -H "Authorization: Bearer $MARKETPULSE_API_KEY" \
  "https://api.example.com/v1/observations/latest?data_type=RICE50&market=ng-lagos-mile12"
```

```json
{
  "data_type": "RICE50",
  "market": "ng-lagos-mile12",
  "geohash": "s14b3k9x",
  "value": "8250000",
  "decimals": 2,
  "currency": "NGN",
  "n_reports": 9,
  "confidence_bps": 8700,
  "finalised_at": "2026-01-15T09:42:11Z",
  "request_id": "12345",
  "challenge_status": "closed",
  "evidence_bundle_url": "https://.../bundle/12345"
}
```

*(Example values are illustrative.)*

### Reporter endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/v1/auth/otp/request` | Send SMS OTP |
| POST | `/v1/auth/otp/verify` | Verify OTP, issue session |
| POST | `/v1/reporters` | Enroll and register passkey wallet |
| GET | `/v1/tasks` | Assigned tasks for the current reporter |
| POST | `/v1/evidence` | Upload evidence; returns the hash to commit on-chain |
| POST | `/v1/relay` | Submit a signed transaction for fee sponsorship |
| GET | `/v1/me/earnings` | Balances, pending payouts, slash history with reasons |

### Admin endpoints

Restricted and audit-logged: suspend a reporter, review flags, schedule audits, manage data types.

## 20. Consuming the oracle on-chain

Another Soroban contract reads the feed:

```rust
use soroban_sdk::{contract, contractimpl, contractclient, Address, BytesN, Env, Symbol};

#[contractclient(name = "OracleFeedClient")]
pub trait OracleFeed {
    fn get_latest(env: Env, data_type: Symbol, geohash: BytesN<8>) -> Option<Observation>;
}

#[contract]
pub struct MyConsumer;

#[contractimpl]
impl MyConsumer {
    pub fn check_price(env: Env, feed: Address, geohash: BytesN<8>) -> i128 {
        let client = OracleFeedClient::new(&env, &feed);
        let obs = client
            .get_latest(&Symbol::new(&env, "RICE50"), &geohash)
            .expect("no observation");

        // Always validate before trusting
        let now = env.ledger().timestamp();
        assert!(now - obs.finalised_at <= 86_400, "stale");   // freshness
        assert!(obs.n_reports >= 5, "too few reports");       // quorum
        assert!(obs.confidence_bps >= 7_000, "low confidence"); // agreement
        obs.value
    }
}
```

**Integrator guidance:** always check freshness, minimum reports, and confidence. For high-value triggers, require two consecutive observations, add a delay after finalisation (so the challenge window has closed), and consider combining with another data source.

## 21. Parametric insurance integration

MarketPulse Oracle is designed to feed parametric products, for example:

- **Price-drop cover for farmers:** pays out if the median maize price in the nearest market falls below a threshold for N consecutive observations.
- **Supply-shock cover for traders:** pays out if fuel availability is reported as "unavailable" along a corridor for more than X days.
- **Business interruption for small shops:** pays out if grid outage duration exceeds a threshold within a period.

### Design rules for insurance consumers

1. Use only **finalised** observations after the challenge window.
2. Require a **minimum number of reports and confidence**.
3. Use **multi-observation triggers** (consecutive or windowed), not a single data point.
4. Cap payout per period to bound the damage from any oracle failure.
5. Keep a **human-in-the-loop override** or dispute path for large payouts during the early phase.
6. Be aware of the **incentive to manipulate**: a beneficiary has reason to bribe reporters. The higher the payout relative to oracle security spend (stakes plus audits), the weaker the guarantee. Size triggers accordingly.

Insurance is a regulated activity in most West African jurisdictions. Work with a licensed insurer or underwriter. See [section 22](#22-legal-compliance-and-privacy).

## 22. Legal, compliance, and privacy

> This section is a checklist of topics to take to qualified local counsel. It is not legal advice.

- **Data protection:** personal data (phone numbers, photos, locations) falls under laws such as Nigeria's data protection law and Ghana's Data Protection Act, among others across the region. Collect the minimum, define retention, obtain consent, and keep personal data off-chain. On-chain data must contain only hashes, coarse geohashes, and aggregates.
- **Location privacy:** use market-level geohash precision for public data. Do not publish reporters' exact locations or movement histories.
- **Digital assets and payments:** rules on holding, transferring, and cashing out stablecoins vary by country and change often. Confirm what is permitted before launch in each market, and who needs a licence (you, anchors, partners).
- **Staking and slashing:** have counsel review whether staking and rewards could be characterised as gambling, securities, or deposit-taking in each jurisdiction.
- **Insurance:** requires licensed partners. Parametric products are still insurance.
- **Sensitive data types:** parallel-market FX reporting and checkpoint or security-related reports can carry legal and personal safety risks for reporters. Assess before enabling, and consider excluding them at launch.
- **Reporter safety:** reporting fuel queues, checkpoints, or prices can sometimes put people at risk. Provide guidance and let reporters skip any task without penalty if they feel unsafe.
- **Tax:** reporter earnings may be taxable. Provide clear statements and records.
- **Terms and policies:** reporter terms (including slashing rules and appeals), buyer terms, privacy policy, acceptable use.

## 23. Observability and operations

- **Metrics (Prometheus/Grafana):** requests created and resolved, time to resolution, reports per request, slash rate, dispute rate, audit pass rate, reporter retention, relayer spend, RPC error rate, indexer lag.
- **Logging:** structured JSON logs with request and trace IDs; no personal data in logs.
- **Alerts:** indexer lag, resolution backlog, relayer balance low, abnormal slash or dispute rate, RPC failures, TTL nearing expiry.
- **Runbooks (`docs/runbooks/`):** pause procedure, arbiter rotation, RPC failover, relayer top-up, TTL extension sweep, incident response.
- **Data quality dashboard:** per-market coverage, freshness, agreement rate, audit results, correlation flags.

## 24. Roadmap

| Phase | Focus | Outcome |
|---|---|---|
| **0: Discovery (weeks 0-2)** | Pick launch country and first paying buyer; define the first data type precisely; legal scoping | Clear problem statement and data spec |
| **1: MVP (weeks 2-8)** | `RequestBoard` + `ReportEngine` with commit-reveal, weighted median, payout and slash; PWA; multisig fallback arbiter; testnet | Working end-to-end loop with known reporters |
| **2: Pilot (weeks 8-16)** | 20-50 reporters in one city, one data type; tune stake, bounty, tolerance; first buyer using the API | Real-world parameters and retention data |
| **3: Trust layer (months 4-6)** | Reputation weighting, random paid audits, evidence checks, correlation analytics, disputes | Credible resistance to collusion |
| **4: Expansion (months 6-9)** | More markets, fuel and power data types, USSD fallback, cash-out integrations, audit | Multi-city coverage, mainnet readiness |
| **5: Integrations (months 9+)** | Parametric insurance feeds, multi-country, francophone West Africa, public data portal | Oracle used by external contracts |

## 25. Pilot plan

A suggested first pilot (adjust to your chosen country and buyer):

1. **Choose one data type and market cluster.** Example: `RICE50` and `TOMATO` across 3 to 5 markets in one city.
2. **Recruit 30 to 50 reporters** via market associations, cooperatives, or university networks, with 3 to 5 vouching agents.
3. **Fund bounties** from a small treasury or a pilot buyer (a trading company, a research group, or an NGO).
4. **Run for 4 to 6 weeks on testnet** with real people and play-money, or on mainnet with very small capped amounts after legal review.
5. **Measure:** reporter retention, report agreement rate, time to resolution, cost per accepted data point, buyer willingness to pay, share of reports passing audit.
6. **Decide:** if reporters stay, quality is high, and a buyer pays, expand. If not, change incentives before scaling.

Success metrics to define up front: reports per market per day, median agreement spread, audit pass rate above a target, reporter 30-day retention, and revenue per data point versus cost per data point.

## 26. Contributing

Contributions are welcome.

1. Read `docs/CONTRIBUTING.md` and the code of conduct.
2. Open an issue before large changes.
3. Fork, branch, and open a PR with tests and updated docs.
4. For contract changes: include property tests and benchmark results, and request review from two maintainers.
5. For security issues: do **not** open a public issue. Follow [responsible disclosure](#responsible-disclosure).

Good first areas: data type specifications for new staples, translations (Hausa, Yoruba, Igbo, Pidgin, Twi, French), evidence-check improvements, economic simulations, and documentation.

## 27. FAQ

**Why Stellar and Soroban?**
Low transaction costs make micro-payments viable, USDC is natively supported, passkey-based smart wallets and fee sponsorship let non-crypto users participate, and Stellar has an established anchor ecosystem for cash-out.

**Why not just use an existing oracle network?**
Existing oracle networks focus on global, financial data. Local informal-market data in West Africa does not exist on them, and it requires local reporters, local incentives, and local verification.

**What stops people from lying together?**
Nothing is perfect, which is why the design layers random assignment, reputation, identity cost, evidence checks, correlation detection, and paid ground-truth audits. See [section 11](#11-anti-sybil-and-anti-collusion-design).

**Do reporters need crypto knowledge?**
No. Passkey wallets, sponsored fees, local-currency displays, and plain-language explanations are core requirements.

**Can buyers pay in local currency?**
Yes, the intent is fiat billing for buyers (for example via Paystack or Flutterwave), with bounties funded in USDC by the platform. Treasury and FX handling need care and legal review.

**Is the data public?**
Finalised observations are readable on-chain. Buyer-facing APIs may offer richer, lower-latency access under commercial terms. Personal data is never public.

**Is this audited?**
No. See the status note at the top.

## 28. Glossary

| Term | Meaning |
|---|---|
| **Soroban** | Stellar's smart contract platform |
| **SAC** | Stellar Asset Contract, the contract interface for Stellar assets such as USDC |
| **Commit-reveal** | Submit a hash first, reveal the value later, to prevent copying |
| **Weighted median** | Median where each report counts in proportion to reporter weight |
| **Slashing** | Forfeiting some or all of a stake as a penalty |
| **Sybil attack** | One actor pretending to be many participants |
| **Geohash** | A string encoding of a geographic area; longer means more precise |
| **TTL** | Time-to-live of Soroban storage entries; entries expire unless extended |
| **Anchor** | A Stellar entity that converts between on-chain assets and local currency |
| **Passkey** | A device-bound, biometric-unlocked credential replacing passwords and seed phrases |
| **Parametric insurance** | Insurance that pays automatically when a measured parameter crosses a threshold |
| **Relayer** | A service that submits transactions and pays their fees on a user's behalf |
| **USSD** | A GSM text-menu protocol accessible from feature phones |

## 29. License

Licensed under the Apache License 2.0. See [`LICENSE`](./LICENSE).
