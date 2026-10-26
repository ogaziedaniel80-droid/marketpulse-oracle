# Threat Model

**File:** `docs/threat-model.md`  
**Version:** v1 (pre-audit)

Maps every attack scenario from README section 11 to its mitigation status in
the current implementation.

---

## Trust assumptions (v1)

| Assumption | Status |
|---|---|
| Stellar network and Soroban runtime are correct | Accepted |
| Fallback arbiter multisig acts honestly | Accepted (admin multisig, time-lock upgrade path planned) |
| Off-chain checks (EXIF, geo) are advisory only | Implemented — flags disputes, does not unilaterally slash |
| Relayer does not custody funds | Correct — relayer only fee-sponsors, no asset custody |

---

## Attack scenarios (README section 11)

### 1. Sybil swarm to control the median

**Attack:** One actor runs many wallets and controls enough weight to shift the
weighted median.

**Mitigations implemented:**
- `Registry`: new reporters start at Tier 1 with `weight_bps` ≈ 1 000–2 500 bps
  (10–25%); caps enforced per tier.
- `Registry`: reputation builds slowly (+1 per confirmation), drops fast (−5 per
  outlier). Tier promotion requires 20+ confirmations at Tier 1.
- `ReportEngine::commit`: stake cap enforced at commit time from Registry snapshot.
- Commit-reveal: reporters cannot see others' values before committing.
- **GAP:** Phone/OTP and device attestation are off-chain; not enforced by the
  contracts themselves. The Registry accepts any `attestation` hash. A stronger
  identity layer (ZK proof, BrightID) is planned for Phase 3.

**Residual risk:** Medium until identity cost is hardened.

---

### 2. Colluding group reports a false price (e.g. to trigger insurance payout)

**Attack:** A coordinated group of reporters with sufficient collective weight
submits a false value.

**Mitigations implemented:**
- Weighted median is robust to a minority of colluders (< 50% weight).
- `ReportEngine`: diversity requirement parameter exists in design; not yet
  enforced on-chain (v1 TODO — see ADR 0003).
- `Disputes`: any party can challenge with a bond; majority panel vote can void.
- Random paid audits (off-chain): a fraction of requests are ground-truth checked.
- **GAP:** Diversity requirement not yet on-chain enforced.
- **GAP:** Paid audit scheduling is off-chain (worker); contract only records the
  audit fund balance.

**Residual risk:** Medium for high-value requests without diversity enforcement.

---

### 3. Copying others after reveal begins (free-riding)

**Attack:** Reporter waits for others to reveal, then copies the most common value.

**Mitigation implemented:**
- `ReportEngine::commit` + `ReportEngine::reveal`: standard commit-reveal scheme.
  Commitment is `sha256(value || salt)`; value is hidden until after
  `commit_deadline`. Copying is only possible for values revealed before the
  reporter's own reveal — and the reporter's commitment is already locked in.
- Copying after `commit_deadline` does not help: a report without a prior matching
  commitment fails `CommitmentMismatch`.

**Status: Fully mitigated.**

---

### 4. Griefing — commit and never reveal

**Attack:** Reporter commits (locking stake) but deliberately withholds the reveal,
preventing resolution or driving up non-reveal counts.

**Mitigation implemented:**
- `ReportEngine::resolve`: non-revealers are slashed 50% of stake (default).
- Non-reveal slash proceeds go to audit fund (30%) and treasury (20%), not the
  attacker.
- The reputation penalty (−5) is applied to non-revealers.

**Status: Mitigated. Cost of griefing = 50% of stake + reputation loss.**

---

### 5. Photo reuse or stock images as evidence

**Attack:** Reporter submits a hash of a recycled or stock image as evidence.

**Mitigations:**
- On-chain: evidence hash is stored; the contract does not validate image content.
- Off-chain: `evidence-check` service uses pHash duplicate detection and EXIF
  analysis (README section 5). Flags are surfaced to the dispute panel.
- **GAP:** Off-chain checks feed disputes, not automatic slashing. A fraudulent
  reporter can still collect a payout if no dispute is filed.

**Residual risk:** Low for individual cases; high at scale without the evidence
service running.

---

### 6. Bribery of reporters by an insurance beneficiary

**Attack:** An insurance beneficiary pays reporters to submit a false trigger value.

**Mitigations implemented:**
- Randomised assignment (off-chain in v1): beneficiary does not know which
  reporters will be assigned until after commit.
- Commit-reveal hides values from other reporters during the commit phase.
- Diversity requirement (v1 TODO): multiple reputation clusters required.
- Random paid audits serve as a ground-truth check.
- **GAP:** Assignment is off-chain in v1. On-chain randomised assignment would be
  stronger (Phase 3).

**Residual risk:** Medium for high-payout insurance triggers.

---

### 7. Spam requests to drain reporters

**Attack:** Attacker posts many cheap requests to exhaust reporters' stake capacity.

**Mitigation implemented:**
- `RequestBoard::create_request`: minimum bounty enforced (`DEFAULT_MIN_BOUNTY` =
  3 USDC). Attacker must deposit real funds.
- Requester reputation can be added as an additional gate (v1 TODO).

**Status: Mitigated at low levels. No zero-cost attack vector.**

---

### 8. Frivolous disputes

**Attack:** A bad actor files repeated disputes to delay finalisation and drain
challenger bonds.

**Mitigation implemented:**
- `Disputes::challenge`: bond must be ≥ 5× `min_stake`. Default for a standard
  request ≥ 12 500 000 minor units (1.25 USDC).
- Rejected dispute: bond slashed 70% to audit fund, 30% to treasury. Attacker
  loses most of the bond.
- Panel ruling timeout default: rejected (attacker loses bond even if panel
  abstains).

**Status: Economically deterred. Bond sizing must be tuned per pilot.**

---

### 9. Admin key compromise

**Attack:** Attacker steals the admin multisig key and drains the protocol or
bans all reporters.

**Mitigations planned:**
- Admin key should be a multisig (M-of-N) stored in a KMS/HSM (README section 13).
- Upgrade path should be time-locked (v1 TODO — not yet implemented in contracts).
- Separate keys per environment and per role.
- **GAP:** Time-lock upgrade is not yet in the contracts.

**Residual risk:** High until time-lock and multisig ceremony are implemented.**
**Action:** Implement `set_admin` with a `pending_admin` + delay pattern before mainnet.

---

### 10. Oracle manipulation of consuming contracts

**Attack:** A consuming contract reads a freshly-finalised observation without
checking staleness, quorum, or confidence, and is triggered incorrectly.

**Mitigation implemented:**
- `OracleFeed` exposes `confidence_bps`, `n_reports`, `finalised_at` on every
  `Observation`.
- Reference consumer in README section 20 checks all three.
- Challenge window must expire before `finalise()` can be called; OracleFeed is
  only written at finalisation.
- **GAP:** The contract cannot prevent consumers from ignoring these fields.

**Guidance:** Consuming contracts MUST check freshness (≤ 24 h), n_reports (≥ 5),
and confidence_bps (≥ 7 000). Parametric triggers should require two consecutive
observations.

---

## Summary table

| # | Attack | Implemented | Residual risk | Phase |
|---|---|---|---|---|
| 1 | Sybil swarm | Partial (stake caps, slow reputation) | Medium | Phase 3: on-chain identity |
| 2 | Collusion / false price | Partial (median, disputes) | Medium | Phase 3: diversity enforcement |
| 3 | Copying after reveal | Full (commit-reveal) | None | Done |
| 4 | Commit-and-no-reveal griefing | Full (non-reveal slash) | None | Done |
| 5 | Photo reuse | Partial (off-chain pHash) | Low | Phase 2: evidence service |
| 6 | Reporter bribery | Partial (commit-reveal, audits) | Medium | Phase 3: on-chain assignment |
| 7 | Spam requests | Full (min bounty) | None | Done |
| 8 | Frivolous disputes | Full (bond sizing + slash) | None | Done |
| 9 | Admin key compromise | Partial (multisig planned) | High | Pre-mainnet: time-lock |
| 10 | Oracle consumer manipulation | Partial (metadata exposed) | Low | Consumer responsibility |

---

## Pre-mainnet checklist gaps

These items are **required before mainnet** per README section 13:

- [ ] Independent smart contract audit
- [ ] `set_admin` time-lock (pending_admin + delay)
- [ ] Diversity requirement parameter enforced on-chain
- [ ] On-chain reporter assignment using finalised multi-party seed
- [ ] Fuzz targets building and running in CI (see `cargo-fuzz` targets)
- [ ] Bug bounty programme live
- [ ] Incident response runbook (`docs/runbooks/`) completed
- [ ] Legal review in each launch country
