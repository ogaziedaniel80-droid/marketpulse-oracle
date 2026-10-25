use crate::types::{
    Observation, ReporterStatus, ReputationInfo, Request, RequestParams, RequestStatus,
};
use soroban_sdk::{contractclient, Address, BytesN, Env, Symbol, Vec};

#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface {
    /// Enrolls a new reporter with Tier 1 and initial baseline reputation.
    fn enroll(env: Env, reporter: Address, attestation: BytesN<32>);

    /// Returns full reputation info and tier stats for a reporter.
    fn reputation(env: Env, reporter: Address) -> ReputationInfo;

    /// Returns current weight in basis points (snapshot for commit).
    fn weight_bps(env: Env, reporter: Address) -> u32;

    /// Returns current maximum stake permitted based on tier and reputation.
    fn stake_cap(env: Env, reporter: Address) -> i128;

    /// Updates a reporter's reputation score (restricted to authorized caller).
    fn update_reputation(
        env: Env,
        caller: Address,
        reporter: Address,
        delta: u32,
        is_positive: bool,
    );

    /// Sets a reporter's status (Active, Suspended, Banned).
    fn set_status(env: Env, caller: Address, reporter: Address, status: ReporterStatus);

    /// Records a vouching relationship with a locked voucher stake.
    fn vouch(env: Env, voucher: Address, reporter: Address, lock_stake: i128);

    /// Slashes voucher liability upon proven reporter fraud.
    fn slash_voucher(
        env: Env,
        caller: Address,
        reporter: Address,
        fraud_slash_fraction_bps: u32,
    ) -> i128;
}

#[contractclient(name = "RequestBoardClient")]
pub trait RequestBoardInterface {
    /// Creates a request, escrows the USDC bounty, and returns request ID.
    fn create_request(env: Env, requester: Address, params: RequestParams) -> u64;

    /// Cancels a request before any commits exist and refunds escrowed bounty.
    fn cancel_request(env: Env, requester: Address, request_id: u64);

    /// Cancels under-subscribed request past commit deadline with fewer than min_reports.
    fn cancel_undersubscribed(env: Env, caller: Address, request_id: u64, commit_count: u32);

    /// Fetches request by ID.
    fn get_request(env: Env, request_id: u64) -> Request;

    /// Returns the current lifecycle status of a request.
    fn request_status(env: Env, request_id: u64) -> RequestStatus;

    /// Returns whether the data type symbol is approved on the board.
    fn is_approved_data_type(env: Env, data_type: Symbol) -> bool;
}

#[contractclient(name = "OracleFeedClient")]
pub trait OracleFeedInterface {
    /// Fetches latest finalised observation for a data type and market geohash.
    fn get_latest(env: Env, data_type: Symbol, geohash: BytesN<8>) -> Option<Observation>;

    /// Fetches historical finalised observations up to limit.
    fn get_history(env: Env, data_type: Symbol, geohash: BytesN<8>, limit: u32)
        -> Vec<Observation>;
}
