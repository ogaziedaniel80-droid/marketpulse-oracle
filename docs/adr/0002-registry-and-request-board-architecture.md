# 0002. Registry and RequestBoard Architecture & Access Control

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** MarketPulse Core Architecture Team
- **Consulted:** Smart Contract Engineer, Security Lead
- **Informed:** Product Team, Fullstack Team

---

## Context and Problem Statement

Per README Sections 4.1, 8.1, 8.3, 10, 11, and 12.1, MarketPulse Oracle requires a modular contract architecture separating reporter identity and reputation (`Registry`) from market request creation and escrow (`RequestBoard`).

We need to specify:

1. Exact public interfaces and any refinements relative to README 8.3 sketches.
2. The cross-contract access control model.
3. Token escrow and refund accounting.
4. Storage tier selection and TTL extension policies.

---

## Decision Drivers

- **Resource Limits:** Keep contract byte sizes and execution footprints small for Soroban CPU and rent limits.
- **Strict Authorization:** Enforce `require_auth()` on every acting address and reject unauthorized state changes.
- **Economic Invariant:** Escrow conservation—contract token balance must always equal the sum of active escrowed bounties.
- **Sybil Resistance:** Tiered onboarding with slow-up / fast-down reputation and voucher liability.

---

## Decision Outcome

### 1. Interface Refinements Relative to README 8.3 Sketch

README Section 8.3 provided an initial sketch of public functions. We implement these exact functions, supplemented by necessary operational methods:

#### `RequestBoard`

- `create_request(env, requester, params) -> u64`: Validates boundaries, escrows USDC bounty via SAC interface, stores `Request`, and returns unique ID.
- `cancel_request(env, requester, request_id)`: Allowed only before any commit exists, returning 100% of escrowed bounty to requester.
- `cancel_undersubscribed(env, caller, request_id, commit_count)`: Permissionless cancellation when commit deadline passes with fewer than `min_reports` commitments.
- `record_commit(env, caller, request_id)`: Authorized method called by `ReportEngine` to increment commit count.
- Views: `get_request`, `request_status`, `is_approved_data_type`, `list_open_requests(cursor, limit)`.
- Admin: `add_data_type`, `remove_data_type`, `set_admin`, `set_authorized_caller`.

#### `Registry`

- `enroll(env, reporter, attestation)`: Requires reporter auth; enrolls at Tier 1 with baseline reputation (`score = 10`, `cap = 1.00 USDC`).
- `reputation(env, reporter) -> ReputationInfo`: Comprehensive reporter stats.
- `weight_bps(env, reporter) -> u32`: Snapshot weight in basis points.
- `stake_cap(env, reporter) -> i128`: Maximum permitted stake derived from tier.
- `update_reputation(env, caller, reporter, delta, is_positive)`: Restricted to authorized callers (`ReportEngine`, `Disputes`, `Admin`) with delta bounded by `max_delta_per_req` (default 10).
- `reset_reputation_fraud(env, caller, reporter)`: Resets score to 0 and bans reporter upon proven fraud.
- `vouch(env, voucher, reporter, lock_stake)`: Locks voucher stake for community-backed vouching.
- `slash_voucher(env, caller, reporter, fraction_bps) -> i128`: Slashes voucher stake upon proven reporter fraud.

### 2. Access Control Model

Each contract maintains an `AuthorizedCaller(Address) -> bool` mapping in instance storage:

- `ReportEngine` and `Disputes` contracts are added as authorized callers during deployment.
- State-changing updates (`update_reputation`, `set_status`, `record_commit`, `slash_voucher`) require both `caller.require_auth()` and membership in `AuthorizedCaller`.
- Multisig admin controls `set_admin`, `set_params`, and authorized caller configuration.

### 3. Escrow Invariant Verification

Using `proptest`, we prove the invariant:
$$\text{token\_balance}(\text{RequestBoard}) = \sum_{r \in \text{OpenRequests}} r.\text{bounty}$$
across arbitrary sequences of creation and cancellations.

---

## Consequences

- Clean modular separation between identity/reputation and request escrow.
- Both contracts compile to optimized Wasm binaries under 17 KB.
- Cross-contract client traits defined in `contracts/shared/src/interfaces.rs` provide typed, ergonomic integration for `ReportEngine`.
