use soroban_sdk::{contracttype, Address, BytesN, Symbol, Vec};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RequestStatus {
    Open = 0,
    Revealing = 1,
    Resolving = 2,
    Challengeable = 3,
    Disputed = 4,
    Finalised = 5,
    Cancelled = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Request {
    pub id: u64,
    pub requester: Address,
    pub data_type: Symbol,  // e.g. Symbol::new(&env, "RICE50")
    pub geohash: BytesN<8>, // coarse market-level geohash
    pub bounty: i128,       // in token minor units
    pub token: Address,     // USDC SAC address
    pub min_stake: i128,
    pub tolerance_bps: u32,   // e.g. 800 = 8.00%
    pub commit_deadline: u64, // ledger timestamp
    pub reveal_deadline: u64,
    pub challenge_window: u64, // seconds after resolve
    pub min_reports: u32,
    pub max_reports: u32, // bounded for CPU budget (max 15)
    pub status: RequestStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestParams {
    pub data_type: Symbol,
    pub geohash: BytesN<8>,
    pub bounty: i128,
    pub token: Address,
    pub min_stake: i128,
    pub tolerance_bps: u32,
    pub commit_deadline: u64,
    pub reveal_deadline: u64,
    pub challenge_window: u64,
    pub min_reports: u32,
    pub max_reports: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Report {
    pub reporter: Address,
    pub commitment: BytesN<32>, // sha256(value || salt)
    pub value: Option<i128>,    // set at reveal, fixed-point
    pub evidence_hash: Option<BytesN<32>>,
    pub stake: i128,
    pub weight_bps: u32, // snapshot of reputation weight at commit
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub request_id: u64,
    pub data_type: Symbol,
    pub geohash: BytesN<8>,
    pub value: i128,         // weighted median
    pub confidence_bps: u32, // agreement and report-count based
    pub n_reports: u32,
    pub finalised_at: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReporterStatus {
    Active = 0,
    Suspended = 1,
    Banned = 2,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReporterTier {
    Tier1 = 1,
    Tier2 = 2,
    Tier3 = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationInfo {
    pub reporter: Address,
    pub score: u32,
    pub tier: ReporterTier,
    pub status: ReporterStatus,
    pub confirmed_count: u32,
    pub outlier_count: u32,
    pub fraud_count: u32,
    pub weight_bps: u32,
    pub stake_cap: i128,
    pub attestation_hash: BytesN<32>,
}

// ---------------------------------------------------------------------------
// Assignment and randomness types (used by ReportEngine assignment)
// ---------------------------------------------------------------------------

/// Submitted by a party during the two-phase seed commitment for panel/assignment randomness.
/// Phase 1: submit sha256(secret || nonce) — the commitment.
/// Phase 2: reveal secret and nonce — verified against commitment.
/// See docs/randomness.md for the full protocol.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SeedCommitment {
    /// The committer (reporter, admin, or dedicated entropy contributor).
    pub contributor: Address,
    /// sha256(secret || nonce) submitted in phase 1.
    pub hash: BytesN<32>,
    /// Revealed secret (set to None until reveal phase).
    pub revealed_secret: Option<BytesN<32>>,
}

/// Accumulated multi-party seed used for assignment or panel selection.
/// Finalised by XOR-ing all revealed secrets.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssignmentSeed {
    /// XOR of all revealed secrets.
    pub seed: BytesN<32>,
    /// Ledger sequence number at which the seed was finalised.
    pub finalised_at_ledger: u32,
}

/// Dispute record stored per request.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRecord {
    pub request_id: u64,
    pub challenger: Address,
    pub bond: i128,
    pub reason: Symbol,
    pub challenged_at: u64,
    /// Deadline by which the panel must rule.
    pub ruling_deadline: u64,
    /// Whether the dispute has been ruled on.
    pub ruled: bool,
    /// True if dispute was upheld, false if rejected.
    pub upheld: Option<bool>,
    /// Votes: (panel_member, upheld_vote).
    pub votes: Vec<(Address, bool)>,
}

/// Payout record for a single reporter on a single request.
/// Used to enforce single-claim invariant.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutRecord {
    /// Total amount claimable (stake return + reward).
    pub claimable: i128,
    /// Whether the reporter has already claimed.
    pub claimed: bool,
}

/// Resolution result stored after resolve() runs.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolutionResult {
    /// The weighted median value.
    pub median_value: i128,
    /// confidence_bps from the formula in docs/confidence.md.
    pub confidence_bps: u32,
    /// Number of accepted (in-tolerance) reports.
    pub n_accepted: u32,
    /// Total slashed amount across all reporters.
    pub total_slashed: i128,
    /// The challenge window end timestamp.
    pub challenge_window_end: u64,
    /// Dust remainder accumulated from rounding.
    pub dust: i128,
}
