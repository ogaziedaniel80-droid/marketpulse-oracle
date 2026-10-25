use soroban_sdk::{contracttype, Address, BytesN, Symbol};

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
    pub data_type: Symbol,      // e.g. Symbol::new(&env, "RICE50")
    pub geohash: BytesN<8>,     // coarse market-level geohash
    pub bounty: i128,           // in token minor units
    pub token: Address,         // USDC SAC address
    pub min_stake: i128,
    pub tolerance_bps: u32,     // e.g. 800 = 8.00%
    pub commit_deadline: u64,   // ledger timestamp
    pub reveal_deadline: u64,
    pub challenge_window: u64,  // seconds after resolve
    pub min_reports: u32,
    pub max_reports: u32,       // bounded for CPU budget (max 15)
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
    pub weight_bps: u32,        // snapshot of reputation weight at commit
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub request_id: u64,
    pub data_type: Symbol,
    pub geohash: BytesN<8>,
    pub value: i128,            // weighted median
    pub confidence_bps: u32,    // agreement and report-count based
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
