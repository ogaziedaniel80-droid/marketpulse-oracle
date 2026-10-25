// -----------------------------------------------------------------------------
// Default Economic & Operational Parameters (from README Sections 8.5 & 10)
// Expressed as default baselines, not immutable hard-coded limits.
// -----------------------------------------------------------------------------

// Stakes in USDC SAC minor units (7 decimals: 1.0 USDC = 10_000_000 units)
pub const DEFAULT_MIN_STAKE_NEW_REPORTER: i128 = 2_500_000; // 0.25 USDC
pub const DEFAULT_STAKE_CAP_TIER_1: i128 = 10_000_000; // 1.00 USDC
pub const DEFAULT_STAKE_CAP_TIER_2: i128 = 50_000_000; // 5.00 USDC
pub const DEFAULT_STAKE_CAP_TIER_3: i128 = 200_000_000; // 20.00 USDC

// Request bounds
pub const DEFAULT_MIN_BOUNTY: i128 = 30_000_000; // 3.00 USDC
pub const DEFAULT_MIN_REPORTS: u32 = 5;
pub const DEFAULT_MAX_REPORTS_CAP: u32 = 15; // Strictly bounded for Soroban CPU budget

// Tolerance and Slashing basis points (10_000 bps = 100.00%)
pub const DEFAULT_TOLERANCE_BPS: u32 = 800; // 8.00%
pub const DEFAULT_OUTLIER_SLASH_BPS: u32 = 2_500; // 25.00% (gentle slash, 20-30% range)
pub const DEFAULT_NON_REVEAL_SLASH_BPS: u32 = 5_000; // 50.00% (heavier slash, 50-100% range)
pub const DEFAULT_FRAUD_SLASH_BPS: u32 = 10_000; // 100.00% (full slash for provable fraud)
pub const DEFAULT_CHALLENGE_BOND_MULTIPLIER: u32 = 5; // 5x average stake
pub const DEFAULT_PROTOCOL_FEE_BPS: u32 = 500; // 5.00% protocol fee

// Slashed Stakes Distribution Splits (README Section 10)
pub const SLASH_SPLIT_BONUS_BPS: u32 = 5_000; // 50% to accepted reporters
pub const SLASH_SPLIT_AUDIT_FUND_BPS: u32 = 3_000; // 30% to audit fund
pub const SLASH_SPLIT_TREASURY_BPS: u32 = 2_000; // 20% to protocol treasury

// Reputation System Constants (README Section 8.4 & 10)
pub const REPUTATION_CONFIRMED_GAIN: u32 = 1; // +1 score per confirmed in-tolerance report
pub const REPUTATION_OUTLIER_PENALTY: u32 = 5; // -5 score per outlier report
pub const MAX_REPUTATION_DELTA_PER_REQ: u32 = 10; // Bounded change per request
pub const INITIAL_REPUTATION_SCORE: u32 = 10;
pub const MAX_REPUTATION_SCORE: u32 = 1_000;
pub const BASE_REPUTATION_WEIGHT_BPS: u32 = 1_000; // 10.00% baseline weight

// Voucher Liability (README Section 11)
pub const DEFAULT_VOUCHER_LOCK_STAKE: i128 = 20_000_000; // 2.00 USDC locked per vouched reporter
pub const DEFAULT_VOUCHER_SLASH_FRACTION_BPS: u32 = 5_000; // 50.00% of locked stake slashed on fraud

// Windows & Timers
pub const DEFAULT_CHALLENGE_WINDOW_SECONDS: u64 = 86_400; // 24 hours
pub const MIN_CHALLENGE_WINDOW_SECONDS: u64 = 3_600; // 1 hour minimum
pub const MAX_CURSOR_LIMIT: u32 = 50;
