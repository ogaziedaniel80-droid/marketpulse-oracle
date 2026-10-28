# Data Protection, Privacy & Retention Architecture

**Status:** Draft for Legal Review — **Requires Review by Qualified Local Counsel in Each Launch Jurisdiction (Nigeria NDPA, Ghana DPA)**  
**Companion Specification:** `README.md` Section 22 (Legal, compliance, and privacy).

> [!IMPORTANT]
> This document is an engineering data-mapping specification, **not legal advice**. Before collecting real reporter data on mainnet, obtain sign-off from qualified local data protection counsel in Nigeria (NDPC / Nigeria Data Protection Act 2023) and any subsequent launch countries.

---

## 1. Core Privacy Invariant: Zero Personal Data On-Chain

No personally identifiable information (PII) is ever written to Stellar Soroban smart contracts or emitted in contract events:

- **No phone numbers** (only off-chain salted SHA-256 hashes).
- **No photographs** (only 32-byte SHA-256 digests).
- **No exact GPS coordinates** (only coarse 6–8 character market-level geohashes representing public market zones).

---

## 2. Data Inventory: What Is Stored Where & Retention Schedule

| Data Element                                       | Storage Location                                  | Access Control                                               | Retention Policy                                                                      |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Salted Phone Hash (`phone_hash`, `phone_salt`)** | PostgreSQL `reporters` table (off-chain)          | Internal API only; never exposed publicly                    | Retained while account is active; purged within 30 days of account deletion request   |
| **Raw Evidence Photo (with EXIF/GPS)**             | Private S3 / MinIO bucket (`rawKey`)              | Restricted to `services/evidence-check` and dispute arbiters | Automatically purged **30 days** after request finalisation (or dispute closure)      |
| **EXIF-Stripped Evidence Photo**                   | Public S3 / MinIO bucket (`public-sanitized-...`) | Buyer API & public audit verification                        | Camera make/model, serials, and GPS IFD stripped on ingest (`MockObjectStorage`)      |
| **On-Chain Commitment & Evidence Hash**            | Soroban `ReportEngine` storage                    | Public ledger (`BytesN<32>` SHA-256 only)                    | Permanent ledger history (non-reversible cryptographic hash; contains no PII)         |
| **Coarse Market Geohash (`6-8` chars)**            | Soroban `OracleFeed` & PostgreSQL `markets`       | Public                                                       | Permanent (identifies a public market such as Wuse Market, never a private residence) |
| **Structured Application Logs**                    | JSON stdout / log aggregator                      | DevOps / Engineering                                         | 14-day rolling retention; PII redaction enforced (`README.md` §23)                    |

---

## 3. Items Requiring Local Legal Counsel Sign-Off Before Mainnet

1. **NDPA / GDPR Lawful Basis & Consent:** Explicit local-language consent wording (`en`, `ha`, `pcm`, `yo`, `ig`) for SMS OTP verification and market stall photography.
2. **Cross-Border Data Transfers:** Hosting regions for managed PostgreSQL and S3/R2 buckets under Nigerian data sovereignty rules.
3. **Staking & Slashing Characterisation:** Confirming that reporter quality bonds and bounty payouts are structured as service-level performance deposits rather than wagering or regulated securities.
