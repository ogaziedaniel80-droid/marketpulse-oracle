# MarketPulse Oracle: System Architecture

**Companion Specification:** `README.md` Section 5 (Architecture) & Section 8 (Smart contract design).

---

## 1. End-to-End Architecture Diagram

```mermaid
flowchart TD
    subgraph Clients["1. Client Layer (Low-Bandwidth West Africa)"]
        PWA["Reporter PWA (apps/web)\nPasskey Smart Wallet + Offline Queue"]
        USSD["USSD / SMS Fallback\n(Design Note: docs/ussd-custody.md)"]
        BuyerUI["Buyer Dashboard & API Consumers"]
    end

    subgraph Edge["2. Application & Verification Layer"]
        API["Fastify REST API (apps/api)\nOTP Auth, Tasks, Buyer Keys, Admin"]
        Relayer["Fee-Sponsoring Relayer\nSponsors XLM Gas for Reporters"]
        EvCheck["Evidence Check Service (services/evidence-check)\nEXIF, dHash Duplicates, Geofence, Entropy"]
        S3["Object Storage (MinIO / S3)\nRaw Private + EXIF-Stripped Public"]
    end

    subgraph Soroban["3. Stellar Soroban Smart Contracts (contracts/)"]
        Reg["Registry\nTier Caps, Reputation, Vouching"]
        Board["RequestBoard\nUSDC Bounty Escrow & Lifecycle"]
        Engine["ReportEngine\nCommit-Reveal, Weighted Median, Slashing"]
        Disp["Disputes\nChallenge Bonds, Multi-Party Seed, Rulings"]
        Feed["OracleFeed\nFinalised Observations (FIFO 100)"]
        USDC["USDC Stellar Asset Contract (SAC)"]
    end

    subgraph Data["4. Indexing & Anti-Collusion Layer"]
        Worker["Worker & Indexer (apps/worker)\nStellar RPC Polling, BullMQ Jobs, Prometheus"]
        PG[("PostgreSQL + PostGIS Mirror\n15 Tables + Geofence Queries")]
        Analytics["Collusion Analytics (analytics/)\nNetworkX Funding Graphs & Timing Correlation"]
    end

    PWA -->|1. Compress + SHA-256 Photo| API
    API -->|2. Store & Strip EXIF| S3
    API -->|3. Verify Integrity| EvCheck
    PWA -->|4. Passkey Signed Commit/Reveal| Relayer
    Relayer -->|5. Fee-Bump Tx| Engine
    BuyerUI -->|Create Request + Escrow| Board
    Board <-->|Transfer USDC| USDC
    Engine <-->|Read Weight/Update Rep| Reg
    Engine <-->|Release Bounty| Board
    Engine -->|Write Finalised Median| Feed
    Disp <-->|Fraud Hook / Rulings| Engine
    Soroban -->|Contract Events| Worker
    Worker -->|Idempotent Mirror| PG
    Analytics <-->|Read Events / Write Flags| PG
```

---

## 2. Trust & Privacy Boundaries

1. **Zero Personal Data On-Chain:** Phone numbers are salted and SHA-256 hashed immediately in `apps/api`. Raw EXIF-bearing photos are restricted in private storage while public copies have all EXIF/GPS tags stripped (`MockObjectStorage`). On-chain contracts store only 32-byte SHA-256 hashes, coarse 6–8 character market geohashes, and integer aggregates.
2. **Advisory Off-Chain Flags:** Neither `services/evidence-check` nor `analytics/` can unilaterally slash a reporter's stake. They emit structured advisory flags into the `flags` table to assist human arbiters and on-chain dispute panels (`contracts/disputes`).
3. **Non-Custodial Fee Sponsorship:** Reporters sign commitments using device-bound WebAuthn passkeys (`PasskeyWalletAccount`). The Relayer wraps transactions in fee-bump envelopes so reporters never need XLM.
