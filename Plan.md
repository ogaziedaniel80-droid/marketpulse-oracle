# MarketPulse Oracle: Project Plan

**Repo:** `marketpulse-oracle`
**Document status:** Draft v0.1
**Companion docs:** `README.md` (what and why), this file (who, when, how)

> Dates are expressed as week numbers from project kickoff (W1 = first week). Estimates are planning assumptions to be revised after each phase gate, not commitments.

---

## 1. Goal and success definition

**Mission:** Build a crowd-sourced, stake-backed local data oracle for West Africa on Stellar Soroban, so that people on the ground are paid for accurate reports on staple prices, fuel availability, road conditions, and power outages, and buyers and smart contracts can rely on the result.

**The project succeeds if, within about 9 months:**

1. A pilot of 30 to 50 reporters produces daily price data for at least 3 markets with a measurable agreement rate and audit pass rate.
2. At least one paying (or committed-to-pay) buyer uses the data.
3. Reporters stay active and are paid out in a way they can actually spend.
4. The contracts have passed an independent audit and are ready for mainnet.

**The project fails (and we should stop or pivot) if:**

- Reporters do not stay engaged after the first month at viable payout levels.
- Report quality cannot be held above the target even with audits.
- No buyer will pay for the data at a price that covers cost per accepted data point.

## 2. Assumptions (to confirm in Phase 0)

| # | Assumption | How we confirm |
|---|---|---|
| A1 | Launch country is Nigeria, with Abuja as the pilot city (markets such as Wuse, Garki, Utako, Kubwa) | Reporter recruitment feasibility, buyer interviews |
| A2 | First data type is the price of a 50 kg bag of rice (`RICE50`), second is tomato price | Buyer interviews |
| A3 | Pilot runs on Stellar testnet first, with a small mainnet phase only after legal review | Legal scoping |
| A4 | Reporters can receive value in USDC and cash out via an anchor, mobile money, or partner | Anchor and payments partner research |
| A5 | A hosted relayer can sponsor fees for passkey smart wallets | Technical spike in W1-W2 |
| A6 | A small paid-audit budget is available from day one of the pilot | Funding plan |

If any assumption fails, update this plan and record the decision in `docs/adr/`.

## 3. Team and roles

Minimum viable team (some roles can be combined early on):

| Role | Count | Responsibilities |
|---|---|---|
| **Product / program lead** | 1 | Buyer discovery, pilot design, priorities, partnerships |
| **Smart contract engineer (Rust/Soroban)** | 1-2 | Contracts, tests, benchmarks, audit fixes |
| **Full-stack engineer (TypeScript)** | 1-2 | PWA, API, worker, indexer, bindings |
| **Data / security engineer (Python)** | 1 (part-time at first) | Evidence checks, clustering, simulations |
| **Community and field operations lead** | 1 | Reporter recruitment, vouching agents, training, support |
| **Field auditors** | 2-4 (contract) | Ground-truth checks for the audit sample |
| **Legal / compliance advisor** | External, on retainer | Data protection, digital assets, insurance |
| **Designer** | 0.5 | Low-bandwidth, multilingual mobile UX |

## 4. Workstreams

| ID | Workstream | Owner | Summary |
|---|---|---|---|
| WS1 | Contracts | Contract engineer | Registry, RequestBoard, ReportEngine, Disputes, OracleFeed |
| WS2 | Application | Full-stack | PWA, API, worker, indexer, relayer integration |
| WS3 | Trust and data quality | Data/security | Evidence checks, geo checks, clustering, simulations |
| WS4 | Reporter network | Field ops | Recruitment, vouching, training, support, payouts |
| WS5 | Buyers and revenue | Product lead | Discovery, API packaging, pricing, first customers |
| WS6 | Legal and compliance | Advisor + product | Licensing, privacy, terms, risk review |
| WS7 | Security and release | Contract + data | Audit, bug bounty, key management, runbooks |
| WS8 | Infra and operations | Full-stack | CI/CD, environments, monitoring, backups |

## 5. Phased plan

### Phase 0: Discovery and foundations (W1-W3)

**Objective:** Pick the first market, buyer, and data spec. Remove the biggest unknowns before writing contract code.

| Task | Stream | Output |
|---|---|---|
| Interview 8-12 potential buyers (traders, aggregators, logistics, NGOs, insurers) | WS5 | Ranked buyer list, willingness to pay, required update frequency |
| Define `RICE50` precisely (unit, grade, location granularity, evidence rule, tolerance) | WS3/WS5 | `packages/shared/src/datatypes/RICE50.md` |
| Spike: passkey smart wallet + fee-sponsoring relayer on testnet | WS2 | Working demo or documented blocker (A5) |
| Spike: Stellar RPC event ingestion and retention limits | WS2 | Indexer design note |
| Research cash-out paths: anchors, mobile money, partners, local P2P | WS4/WS6 | Payout options memo (A4) |
| Initial legal scoping: data protection, stablecoin use, staking/slashing characterisation | WS6 | Risk register, list of questions for counsel |
| Name and namespace checks (GitHub org, npm scope, domain, trademark search) | WS5 | Reserved names |
| Set up monorepo, CI, linting, `.env.example`, ADR folder | WS8 | Repo skeleton |

**Gate G0 (end of W3):**
- [ ] At least 1 buyer willing to run a pilot (letter of intent or verbal commitment)
- [ ] Data spec for `RICE50` approved
- [ ] Relayer and passkey approach confirmed or an alternative chosen
- [ ] A viable payout path identified
- [ ] No legal blocker found for a testnet pilot

### Phase 1: MVP build (W4-W9)

**Objective:** A working end-to-end loop on testnet: request, commit, reveal, resolve, payout, slash.

**Contracts (WS1)**

| Week | Deliverable |
|---|---|
| W4 | Workspace scaffold, shared types and errors, `RequestBoard` (create, escrow, cancel, refund) |
| W5 | `ReportEngine` commit and reveal, commitment verification, deadlines |
| W6 | Weighted median, tolerance check, payout and slash math, claim |
| W7 | Under-subscription cancel path, multisig admin fallback arbiter, events |
| W8 | Property-based tests (escrow conservation, no double-claim), resource-budget benchmarks at `max_reports` |
| W9 | Hardening, TTL handling, testnet deploy scripts, internal review |

**Application (WS2)**

| Week | Deliverable |
|---|---|
| W4 | Next.js PWA shell, i18n (English, Hausa, Pidgin first), design system |
| W5 | Phone OTP auth, passkey wallet creation, relayer integration |
| W6 | Task list, commit and reveal flow with offline queue, photo capture and client-side hashing |
| W7 | API (evidence upload, tasks, earnings), Postgres schema, TS bindings generation |
| W8 | Indexer worker (events into Postgres), resolution trigger job |
| W9 | Buyer dashboard v0 (request creation, observation view), basic API keys |

**Other**

| Task | Stream | Week |
|---|---|---|
| Economic simulation v1 (honest vs lazy vs colluding payoffs, attacker cost to move the median) | WS3 | W6-W8 |
| Reporter training material (short, local-language, image-led) | WS4 | W7-W9 |
| Draft reporter terms (slashing rules, appeals) and privacy policy | WS6 | W7-W9 |
| Monitoring and alerts (indexer lag, resolution backlog, relayer balance) | WS8 | W8-W9 |

**Gate G1 (end of W9):**
- [ ] End-to-end demo (`pnpm demo:e2e`) passes, including an outlier and a non-revealer
- [ ] All invariants in the README pass under property tests
- [ ] Resource usage at `max_reports` is within Soroban limits with margin
- [ ] A reporter can onboard and submit a report on a mid-range Android phone on a poor connection
- [ ] Economic simulation shows honest reporting is the best strategy under baseline assumptions

### Phase 2: Pilot (W10-W19)

**Objective:** Learn real behaviour. Tune parameters. Prove a buyer will use the data.

| Task | Stream | Notes |
|---|---|---|
| Recruit 30-50 reporters through market associations, cooperatives, or university networks | WS4 | Target 3-5 vouching agents |
| Run training sessions and a no-stake practice round | WS4 | Feedback to UX |
| Fund pilot bounties (testnet play-value or small capped mainnet amounts after legal review) | WS5/WS6 | See A3 |
| Launch daily requests for `RICE50` in 3-5 markets | WS1/WS2 | Add tomato after 3 weeks if stable |
| Hire 2-4 field auditors and run random paid audits on 5-10% of requests | WS3/WS4 | Build the ground-truth dataset |
| Weekly parameter review (stake, bounty, tolerance, report count) | All | Log each change in `docs/parameter-log.md` |
| Onboard first buyer to the API and dashboard | WS5 | Collect feedback and willingness to pay |
| Reporter support channel (WhatsApp or SMS line, local language) | WS4 | Track response time |
| Weekly data quality review (agreement, flags, audit results) | WS3 | Dashboard |

**Gate G2 (end of W19):**
- [ ] 30-day reporter retention at or above target (see KPIs)
- [ ] Audit pass rate at or above target
- [ ] Cost per accepted data point is known and sustainable against buyer pricing
- [ ] At least one buyer actively using the data
- [ ] Parameter set documented and stable for 3+ weeks

### Phase 3: Trust layer and hardening (W20-W28)

**Objective:** Make collusion and low-quality reporting expensive, and prepare for audit.

| Task | Stream |
|---|---|
| Reputation-weighted aggregation (slow up, fast down) with tiered stake caps | WS1 |
| Registry vouching with voucher liability | WS1 |
| Disputes contract: bonds, audit panel selection (multi-party seed), rulings | WS1 |
| Evidence service: EXIF checks, perceptual hash duplicate detection, cross-reporter reuse | WS3 |
| Geo-plausibility checks against reporter history and market geofence | WS3 |
| Correlation analytics: wallet clustering, timing and funding-source graphs | WS3 |
| Diversity requirement per request (reports from distinct clusters or sub-areas) | WS1 |
| Fuzzing and property tests for the new modules | WS1/WS7 |
| Admin panel: review flags, suspend reporters, schedule audits | WS2 |
| Key management: multisig, hardware-backed keys, ceremony document | WS7 |
| Select audit firm, freeze scope, begin audit | WS7 |
| Draft incident response and pause runbooks | WS7/WS8 |

**Gate G3 (end of W28):**
- [ ] Red-team exercise: internal attempt to bias the median with sybils succeeds in no more than the defined tolerance, or is detected
- [ ] Audit started; critical and high findings tracked to closure
- [ ] Dispute flow works end to end on testnet
- [ ] Legal review complete for the mainnet launch country

### Phase 4: Expansion and mainnet readiness (W29-W40)

**Objective:** Add data types and markets, open payouts, and go live on mainnet.

| Task | Stream |
|---|---|
| Add `FUEL_PMS`, `FUEL_DSL` (categorical availability plus price) | WS1/WS3 |
| Add `POWER` and `ROAD` after a safety review of reporter risk | WS3/WS6 |
| USSD/SMS fallback channel, with the custody trade-off documented | WS2/WS4 |
| Cash-out integration (anchor and/or mobile money partner) | WS4/WS6 |
| Expand to a second city and 100+ reporters | WS4 |
| Fix audit findings, re-audit changed code | WS7 |
| Launch bug bounty | WS7 |
| Mainnet deployment ceremony, wasm hash verification, `docs/deployments.md` | WS7 |
| Staged mainnet launch with value caps, then raise caps with performance | All |

**Gate G4 (mainnet go/no-go):**
- [ ] Audit complete, all critical and high issues fixed and verified
- [ ] Bug bounty live
- [ ] Pause and upgrade mechanisms tested, time lock configured
- [ ] Payout path works for a real reporter end to end
- [ ] Legal sign-off per launch country
- [ ] Runbooks tested in a drill

### Phase 5: Integrations and scale (W41+)

- First parametric insurance integration with a licensed partner (see README section 21)
- Public data portal and developer docs for on-chain consumers
- Additional countries, including francophone West Africa (French, XOF)
- Decentralise the audit panel and arbiter role progressively
- Revisit tokenomics, protocol fee, and treasury governance

## 6. Milestone timeline (summary)

```
W1────W3   Phase 0  Discovery ........................ G0
W4────W9   Phase 1  MVP build ......................... G1
W10───W19  Phase 2  Pilot ............................. G2
W20───W28  Phase 3  Trust layer + audit prep .......... G3
W29───W40  Phase 4  Expansion + mainnet readiness ..... G4
W41+       Phase 5  Integrations and scale
```

## 7. First 30 days: detailed checklist

**Week 1**
- [ ] Create the GitHub repo `marketpulse-oracle` and set the description and topics
- [ ] Commit `README.md` and `Plan.md`
- [ ] Reserve names (npm scope, domain, social handles) and run a trademark search
- [ ] Schedule the first 5 buyer interviews
- [ ] Set up Rust workspace, pnpm and Turborepo, CI (lint, test, build)
- [ ] Start the passkey and relayer spike

**Week 2**
- [ ] Complete the buyer interviews, and write a one-page summary of what each would pay for
- [ ] Draft the `RICE50` data spec and circulate it for feedback
- [ ] Engage a legal advisor and send the initial questions
- [ ] Document RPC event retention limits and indexer design
- [ ] Contact 2-3 anchors or payment partners about reporter cash-out

**Week 3**
- [ ] Gate G0 review meeting
- [ ] Decide the pilot city and markets, and identify 3-5 candidate vouching agents
- [ ] Lock the MVP scope (what is out: disputes, reputation weights, USSD)
- [ ] Write ADRs for key decisions (wallet approach, indexer, evidence storage)

**Week 4**
- [ ] Contracts scaffold and `RequestBoard` underway
- [ ] PWA shell and i18n running
- [ ] Reporter terms and privacy policy first draft in progress

## 8. KPIs and targets

Targets are initial proposals to adjust after Phase 0 and refine in the pilot.

| Metric | Pilot target | Why it matters |
|---|---|---|
| Active reporters (weekly) | 30-50 | Network size |
| Reports per market per day | 5-10 | Data density |
| Request resolution rate (resolved, not cancelled) | 90% or higher | Reliability |
| Median agreement spread | Within tolerance band for 80% or more of accepted reports | Data quality |
| Audit pass rate | 90% or higher | Ground-truth accuracy |
| 30-day reporter retention | 60% or higher | Sustainability |
| Time to resolution | Under 24 hours (target under 6 hours for daily prices) | Usefulness to buyers |
| Cost per accepted data point | Below buyer price per data point | Unit economics |
| Reporter payout success rate | 95% or higher | Trust |
| Dispute rate | Under 5% (and falling) | Process fairness |
| Buyer API weekly active users | 3 or more organisations | Demand |
| Relayer cost per transaction | Tracked and budgeted | Sustainability |

## 9. Budget (rough planning ranges)

> Illustrative planning ranges in USD for a 9-month plan with a small team. Replace with real quotes as soon as they are available. Salary levels depend heavily on who is hired and where.

| Category | Notes | Estimated range |
|---|---|---|
| Team | 4-6 people, mix of full and part time | Largest cost; set by hiring plan |
| Smart contract audit | One reputable firm, plus re-audit of fixes | Roughly 20,000 to 80,000 depending on scope and firm |
| Field audits | 2-4 auditors, 5-10% sampling | Small recurring cost; model per audit |
| Reporter bounties and bonuses | Pilot: small per request | Bounded by pilot design |
| Infrastructure | Hosting, managed Postgres, RPC, monitoring | Low hundreds per month at pilot scale |
| Messaging | SMS OTP and notifications | Grows with reporter count |
| Legal and compliance | Local counsel in each launch country | Meaningful early cost |
| Bug bounty pool | Funded before mainnet value grows | Set at launch |
| Contingency | Roughly 15-20% | Always |

## 10. Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Reporters do not stay engaged | Medium | High | Fast payouts, clear UX, local-language support, tune bounties in the pilot | WS4 |
| R2 | Collusion or sybil attacks bias results | Medium | High | Identity cost, random assignment, audits, correlation detection, diversity rules | WS3 |
| R3 | No buyer will pay | Medium | High | Early buyer discovery, LOIs before building, pivot data type | WS5 |
| R4 | Cash-out is hard or unreliable | High | High | Research in Phase 0, multiple partners, fallback to partner-assisted payout | WS4/WS6 |
| R5 | Regulatory issues (digital assets, staking, data protection, insurance) | Medium | High | Early legal scoping, testnet first, caps, licensed partners | WS6 |
| R6 | Smart contract bug or exploit | Medium | Very high | Property tests, fuzzing, audit, bug bounty, value caps, pause mechanism | WS7 |
| R7 | Soroban resource limits constrain aggregation | Low | Medium | Cap `max_reports`, benchmark early, keep contracts small | WS1 |
| R8 | Tooling and SDK changes break builds | Medium | Medium | Pin versions, upgrade deliberately, CI on a schedule | WS8 |
| R9 | Relayer or RPC outage blocks reporting | Medium | Medium | Failover providers, offline queue, retry logic | WS2/WS8 |
| R10 | Reporter safety concerns for sensitive data types | Medium | High | Exclude risky types at first, no-penalty skip, safety guidance | WS6 |
| R11 | Poor connectivity and low-end devices hurt UX | High | Medium | PWA with offline queue, compression, USSD fallback | WS2 |
| R12 | Evidence photos misused or personal data leaks | Low | High | Minimal collection, access control, retention limits, no personal data on-chain | WS6/WS8 |
| R13 | Admin key compromise | Low | Very high | Multisig, hardware-backed keys, time lock, key ceremony | WS7 |
| R14 | Beneficiary bribes reporters for insurance triggers | Low (until insurance) | High | Size triggers to oracle security, delay and multi-observation rules | WS5/WS7 |
| R15 | Name conflict or trademark issue | Medium | Low-Medium | Check early, be ready to rename | WS5 |

## 11. Decision log (open decisions)

| # | Decision | Needed by | Options | Current lean |
|---|---|---|---|---|
| D1 | Launch country and pilot city | G0 | Nigeria (Abuja or Lagos), Ghana | Nigeria, Abuja |
| D2 | First data type | G0 | Rice, tomato, fuel | Rice (`RICE50`) |
| D3 | Open enrollment vs vouching-only | G1 | Open with low caps, vouching required | Vouching required in the pilot |
| D4 | Wallet model for USSD users | Phase 4 | Custodial, delegated signing, agent-assisted | Agent-assisted, documented trade-offs |
| D5 | Evidence storage | G1 | R2/S3 only, S3 plus IPFS pinning | S3 first, add IPFS later |
| D6 | Indexer | G1 | In-house worker, Mercury, Goldsky | In-house worker |
| D7 | Fallback arbiter structure | G1 | Team multisig, trusted external panel | External trusted panel, multisig-controlled |
| D8 | Buyer billing | G2 | Fiat via Paystack or Flutterwave, USDC | Fiat, with the platform funding USDC bounties |
| D9 | Audit firm | G3 | To be shortlisted | Shortlist during Phase 2 |
| D10 | Protocol fee and treasury rules | G3 | Fixed percentage, dynamic | Fixed percentage, reviewed after pilot |

Record each final decision as an ADR in `docs/adr/`.

## 12. Dependencies

| Dependency | Needed for | Fallback |
|---|---|---|
| Stellar RPC provider (or self-hosted node) | All on-chain interaction | Second provider |
| Fee-sponsoring relayer | Reporters without XLM | Self-hosted relayer |
| USDC on Stellar and a path to local currency | Payouts | Partner-assisted payout |
| SMS provider covering target countries | OTP and notifications | Second provider |
| Field auditors | Ground truth | Trusted partner organisations |
| Market associations or cooperatives | Reporter recruitment | University and community networks |
| Legal counsel | Compliance | None; do not launch without it |

## 13. Working agreements

- **Cadence:** weekly planning, a short mid-week sync, and a demo at the end of each sprint (2 weeks).
- **Definition of done (contracts):** tests written, invariants hold, benchmarks recorded, bindings regenerated, changelog updated, reviewed by two people.
- **Definition of done (app):** typecheck and lint clean, tests pass, works offline where relevant, translated strings present, accessible on low-end Android.
- **Gates are real:** do not start the next phase until the gate is met, or explicitly record why the team accepts the risk.
- **Parameter changes:** logged with reason and expected effect, and reviewed the following week.
- **Security issues:** handled privately, never in public issues.
- **Documentation:** update `README.md`, ADRs, and runbooks in the same PR as the change.

## 14. Immediate next steps

1. Confirm assumptions A1 to A6, especially the launch country and first data type.
2. Create the repo, then add `README.md` and `Plan.md`.
3. Book buyer interviews and the legal advisor consultation.
4. Start the passkey and relayer spike.
5. Scaffold the Rust workspace and begin the `RequestBoard` contract.
