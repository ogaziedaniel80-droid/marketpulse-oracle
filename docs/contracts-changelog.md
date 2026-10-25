# Smart Contracts Changelog

All notable changes to the MarketPulse Soroban smart contracts are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- Repository scaffold and Cargo workspace configuration.
- Shared contracts crate (`contracts/shared`):
  - Domain types: `RequestStatus`, `Request`, `Report`, `Observation`, `RequestParams`, `ReputationInfo`, `ReporterStatus`, `ReporterTier`.
  - Comprehensive contract errors with stable numeric error codes.
  - Math helpers: basis-point arithmetic (`bps_mul`, `bps_div`), fixed-point operations, tolerance checking, and deterministic `weighted_median`.
  - Default economic parameters from README Section 10.
  - Cross-contract client interfaces: `RegistryClient`, `RequestBoardClient`, and `OracleFeedClient`.
- Contracts:
  - `contracts/registry`: Reporter enrollment, slow-up/fast-down reputation tracking, tiered stake caps, and vouching with liability.
  - `contracts/request-board`: Request creation with USDC bounty escrow, cancellation, under-subscription refund path, and approved data type registry.
  - Skeletons for `contracts/report-engine`, `contracts/disputes`, and `contracts/oracle-feed`.
