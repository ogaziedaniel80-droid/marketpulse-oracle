# Soroban Smart Contracts Storage & TTL Architecture

This document specifies the storage layout, persistence tiering, and Time-To-Live (TTL) lifecycle management for MarketPulse Oracle contracts, adhering to README Section 8.5.

---

## 1. Storage Tiers in Soroban

Soroban provides three storage tiers with distinct persistence, cost, and eviction models:

| Tier                   | Rent Cost                    | Eviction Behavior                          | Use Case in MarketPulse                                       |
| ---------------------- | ---------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| **Instance Storage**   | Tied to contract instance    | Deleted only if contract is deleted        | Admin addresses, protocol parameters, sequence counters       |
| **Persistent Storage** | Periodic rent based on bytes | Archived if TTL reaches 0; can be restored | Reporter profiles, vouch records, request state, observations |
| **Temporary Storage**  | Cheapest; no restoration     | Deleted permanently when TTL reaches 0     | Ephemeral commitments and reveals                             |

---

## 2. Storage Architecture by Contract

### 2.1 Registry (`contracts/registry`)

- **Instance Storage:**
  - `DataKey::Admin -> Address`: Multisig admin address.
  - `DataKey::AuthorizedCaller(Address) -> bool`: Authorized callers (ReportEngine, Disputes, Admin).
  - `DataKey::Params -> RegistryParams`: Dynamic protocol parameters (stake caps, reputation delta limits, voucher requirements).
- **Persistent Storage:**
  - `DataKey::Reporter(Address) -> ReporterProfile`: Stores status, tier, reputation score, confirmed/outlier/fraud counts, and attestation hash. Must never be evicted during active reporter participation.
  - `DataKey::Vouch(Address) -> VouchRecord`: Stores voucher address and locked liability stake.

### 2.2 RequestBoard (`contracts/request-board`)

- **Instance Storage:**
  - `DataKey::Admin -> Address`: Multisig admin address.
  - `DataKey::AuthorizedCaller(Address) -> bool`: Authorized caller registry.
  - `DataKey::NextRequestId -> u64`: Auto-incrementing request ID sequence.
- **Persistent Storage:**
  - `DataKey::Request(u64) -> Request`: Complete request parameters, deadlines, escrow token, and status. Durability is required through commit, reveal, dispute, and final observation phases.
  - `DataKey::RequestCommitCount(u64) -> u32`: Number of commits received for under-subscription and cancellation checks.
  - `DataKey::ApprovedDataType(Symbol) -> bool`: Whitelisted data types.

---

## 3. TTL Lifecycle Management & Rent Strategy

### 3.1 Initial Extension on Creation

When a request is created in `RequestBoard::create_request`:

```rust
let ttl_extension_ledgers = 250_000; // ~14 days at 5s ledger closes
env.storage()
    .persistent()
    .extend_ttl(&key, ttl_extension_ledgers, ttl_extension_ledgers);
```

This guarantees that even with network delays or multi-day challenge windows, active requests remain live and accessible on-chain without risk of eviction.

### 3.2 Off-Chain Worker Sweeping

The background indexer worker (`apps/worker`) maintains an active storage sweep job:

1. Tracks open and in-flight requests.
2. Simulates entry TTL using Stellar RPC `getLedgerEntries`.
3. If an entry's TTL drops below `50,000` ledgers (~3 days), the worker submits an explicit fee-sponsored `extend_ttl` operation.

### 3.3 Ephemeral Data in Temporary Storage

In `ReportEngine`, individual sealed commitments (`sha256(value || salt)`) use temporary storage during the commit-reveal cycle. Once the request resolves or is cancelled, these entries naturally expire without leaving persistent garbage on the ledger.
