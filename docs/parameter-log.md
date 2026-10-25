# Parameter Tuning & Calibration Log

This log tracks all protocol parameters, default values, changes, and their rationales as evaluated through simulations and pilot operations.

---

## Baseline Parameters (Phase 0 / Initial Scaffold)

| Parameter | Default Value | Unit | Description | README Reference |
|---|---|---|---|---|
| `MIN_STAKE_NEW_REPORTER` | `250_000` | USDC (0.25, 7 decimals) | Minimum stake required for Tier 1 reporter | Section 10 |
| `STAKE_CAP_TIER_1` | `1_000_000` | USDC (1.00, 7 decimals) | Maximum stake permitted for Tier 1 reporter | Section 10 |
| `MIN_BOUNTY` | `3_000_000` | USDC (3.00, 7 decimals) | Minimum escrowed bounty to create a request | Section 10 |
| `MIN_REPORTS_DEFAULT` | `5` | count | Minimum reports required to achieve quorum | Section 10 |
| `MAX_REPORTS_CAP` | `15` | count | Upper bound on reports per request (Soroban CPU budget) | Section 8.5, 10 |
| `DEFAULT_TOLERANCE_BPS` | `800` | bps (8.00%) | Consensus tolerance window around weighted median | Section 10 |
| `OUTLIER_SLASH_BPS` | `2_500` | bps (25.00%) | Gentle slash percentage for reports exceeding tolerance | Section 4.2, 10 |
| `NON_REVEAL_SLASH_BPS` | `5_000` | bps (50.00%) | Heavy slash for committed reporters who fail to reveal | Section 10 |
| `FRAUD_SLASH_BPS` | `10_000` | bps (100.00%)| Full slash for proven collusion or fraudulent evidence | Section 10 |
| `CHALLENGE_BOND_MULTIPLIER` | `5` | factor | Bond required to challenge an observation (5x stake) | Section 10 |
| `PROTOCOL_FEE_BPS` | `500` | bps (5.00%) | Protocol fee deducted from bounty to treasury/audits | Section 10 |
| `REPUTATION_CONFIRMED_GAIN` | `1` | score units | Reputation increment for confirmed in-tolerance report | Section 10 |
| `REPUTATION_OUTLIER_PENALTY`| `5` | score units | Reputation deduction for out-of-tolerance report | Section 10 |
| `MAX_REPUTATION_DELTA_PER_REQ`| `10` | score units | Upper bound on reputation change per single request | Section 8.4 |
| `DEFAULT_CHALLENGE_WINDOW` | `86_400` | seconds (24h)| Challenge dispute period post-resolution | Section 8.2 |

---

## Log of Changes

| Date | Parameter | Old Value | New Value | Reason / Simulation Link | Approved By |
|---|---|---|---|---|---|
| 2026-10-25 | All | - | Baseline | Initial parameters baseline from README | Protocol Team |
