#![no_std]

//! ReportEngine — Commit, Reveal, Resolve, Claim, Finalise
//!
//! Implements the full report lifecycle per README sections 4.1, 8, and 10.
//! Economics:
//!   bounty → protocol_fee (treasury) + remainder → accepted reporters pro-rata by weight
//!   slashed outlier stakes → 50% bonus to accepted + 30% audit fund + 20% treasury
//!   slashed non-reveal stakes → same split
//!   full fraud slash (via fraud hook from Disputes) → same split, plus reputation ban

use marketpulse_shared::{
    bps_mul, tolerance_check_bps, weighted_median, ContractError, Observation, PayoutRecord,
    Report, RequestStatus, ResolutionResult, DEFAULT_CHALLENGE_WINDOW_SECONDS,
    DEFAULT_NON_REVEAL_SLASH_BPS, DEFAULT_OUTLIER_SLASH_BPS,
    DEFAULT_PROTOCOL_FEE_BPS, DEFAULT_VOUCHER_SLASH_FRACTION_BPS, REPUTATION_CONFIRMED_GAIN,
    REPUTATION_OUTLIER_PENALTY, SLASH_SPLIT_AUDIT_FUND_BPS, SLASH_SPLIT_BONUS_BPS,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env,
    Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Params,
    AuthorizedCaller(Address),
    /// Cross-contract addresses
    RegistryAddress,
    RequestBoardAddress,
    OracleFeedAddress,
    DisputesAddress,
    /// Treasury and audit fund recipient addresses
    TreasuryAddress,
    AuditFundAddress,
    /// Per-request report list (temporary storage while pending, persistent for claims)
    ReportList(u64),
    /// Per-(request, reporter): Report
    ReportEntry(u64, Address),
    /// Per-request: ResolutionResult (after resolve)
    Resolution(u64),
    /// Per-(request, reporter): PayoutRecord
    Payout(u64, Address),
    /// Per-request: total_weight_accepted — needed for pro-rata split
    AcceptedWeight(u64),
    /// Per-request: commit_count
    CommitCount(u64),
}

// ---------------------------------------------------------------------------
// Contract params
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EngineParams {
    /// Protocol fee taken from bounty (5–10% per README).
    pub protocol_fee_bps: u32,
    /// Gentle outlier slash (20–30% per README, default 25%).
    pub outlier_slash_bps: u32,
    /// Non-reveal slash (50–100% per README, default 50%).
    pub non_reveal_slash_bps: u32,
    /// Voucher liability fraction slashed on fraud (default 50%).
    pub voucher_slash_fraction_bps: u32,
    /// Default challenge window in seconds.
    pub default_challenge_window_secs: u64,
}

impl Default for EngineParams {
    fn default() -> Self {
        Self {
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            outlier_slash_bps: DEFAULT_OUTLIER_SLASH_BPS,
            non_reveal_slash_bps: DEFAULT_NON_REVEAL_SLASH_BPS,
            voucher_slash_fraction_bps: DEFAULT_VOUCHER_SLASH_FRACTION_BPS,
            default_challenge_window_secs: DEFAULT_CHALLENGE_WINDOW_SECONDS,
        }
    }
}

// ---------------------------------------------------------------------------
// External contract client traits (inline — avoids circular dep)
// ---------------------------------------------------------------------------

mod registry_client {
    use soroban_sdk::{contractclient, Address, BytesN, Env};

    use marketpulse_shared::ReporterStatus;

    #[contractclient(name = "RegistryClient")]
    pub trait RegistryInterface {
        fn weight_bps(env: Env, reporter: Address) -> u32;
        fn stake_cap(env: Env, reporter: Address) -> i128;
        fn reputation(
            env: Env,
            reporter: Address,
        ) -> marketpulse_shared::ReputationInfo;
        fn update_reputation(
            env: Env,
            caller: Address,
            reporter: Address,
            delta: u32,
            is_positive: bool,
        );
        fn reset_reputation_fraud(env: Env, caller: Address, reporter: Address);
        fn slash_voucher(
            env: Env,
            caller: Address,
            reporter: Address,
            fraud_slash_fraction_bps: u32,
        ) -> i128;
        fn set_status(env: Env, caller: Address, reporter: Address, status: ReporterStatus);
        fn enroll(env: Env, reporter: Address, attestation: BytesN<32>);
    }
}

mod request_board_client {
    use soroban_sdk::{contractclient, Address, Env};

    use marketpulse_shared::{Request, RequestStatus};

    #[contractclient(name = "RequestBoardClient")]
    pub trait RequestBoardInterface {
        fn get_request(env: Env, request_id: u64) -> Request;
        fn record_commit(env: Env, caller: Address, request_id: u64) -> u32;
        fn set_status(env: Env, caller: Address, request_id: u64, status: RequestStatus);
        fn cancel_undersubscribed(
            env: Env,
            caller: Address,
            request_id: u64,
            commit_count: u32,
        );
        fn release_funds(
            env: Env,
            caller: Address,
            request_id: u64,
            recipient: Address,
            amount: i128,
        );
    }
}

mod oracle_feed_client {
    use soroban_sdk::{contractclient, Address, Env};

    use marketpulse_shared::Observation;

    #[contractclient(name = "OracleFeedClient")]
    pub trait OracleFeedInterface {
        fn write_observation(
            env: Env,
            caller: Address,
            observation: Observation,
        );
    }
}

use oracle_feed_client::OracleFeedClient;
use registry_client::RegistryClient;
use request_board_client::RequestBoardClient;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug)]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct CommitEvent {
    pub request_id: u64,
    pub reporter: Address,
    pub stake: i128,
    pub weight_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RevealEvent {
    pub request_id: u64,
    pub reporter: Address,
    pub value: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ResolvedEvent {
    pub request_id: u64,
    pub median_value: i128,
    pub n_accepted: u32,
    pub confidence_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct ClaimedEvent {
    pub request_id: u64,
    pub reporter: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FinalisedEvent {
    pub request_id: u64,
    pub median_value: i128,
    pub finalised_at: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct FraudSlashAppliedEvent {
    pub request_id: u64,
    pub reporter: Address,
    pub slash_amount: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ReportEngineContract;

#[contractimpl]
impl ReportEngineContract {
    pub fn version(_env: Env) -> u32 {
        2
    }

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    pub fn initialize(
        env: Env,
        admin: Address,
        registry: Address,
        request_board: Address,
        oracle_feed: Address,
        treasury: Address,
        audit_fund: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(admin.clone()), &true);
        env.storage()
            .instance()
            .set(&DataKey::RegistryAddress, &registry);
        env.storage()
            .instance()
            .set(&DataKey::RequestBoardAddress, &request_board);
        env.storage()
            .instance()
            .set(&DataKey::OracleFeedAddress, &oracle_feed);
        env.storage()
            .instance()
            .set(&DataKey::TreasuryAddress, &treasury);
        env.storage()
            .instance()
            .set(&DataKey::AuditFundAddress, &audit_fund);
        env.storage()
            .instance()
            .set(&DataKey::Params, &EngineParams::default());

        InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------------

    /// Reporter commits a sealed report (sha256(value || salt)) with staked funds.
    ///
    /// Invariants enforced:
    /// - require_auth on reporter
    /// - reporter is Active in Registry
    /// - stake >= min_stake, stake <= reporter's stake cap
    /// - before commit_deadline
    /// - one commit per reporter per request
    /// - max_reports not exceeded
    pub fn commit(
        env: Env,
        reporter: Address,
        request_id: u64,
        commitment: BytesN<32>,
        stake: i128,
    ) -> Result<(), ContractError> {
        reporter.require_auth();

        let registry_addr = Self::get_registry_addr(&env)?;
        let board_addr = Self::get_board_addr(&env)?;

        // Fetch request
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);

        if request.status != RequestStatus::Open {
            return Err(ContractError::RequestNotOpen);
        }

        let now = env.ledger().timestamp();
        if now >= request.commit_deadline {
            return Err(ContractError::DeadlinePassed);
        }

        // Check reporter status and snapshot weight/cap from Registry
        let registry = RegistryClient::new(&env, &registry_addr);
        let rep_info = registry.reputation(&reporter);

        match rep_info.status {
            marketpulse_shared::ReporterStatus::Suspended => {
                return Err(ContractError::ReporterSuspended)
            }
            marketpulse_shared::ReporterStatus::Banned => {
                return Err(ContractError::ReporterBanned)
            }
            _ => {}
        }

        if stake < request.min_stake {
            return Err(ContractError::StakeTooLow);
        }
        if stake > rep_info.stake_cap {
            return Err(ContractError::StakeExceedsCap);
        }

        // Enforce one commit per reporter
        let entry_key = DataKey::ReportEntry(request_id, reporter.clone());
        if env.storage().temporary().has(&entry_key) {
            return Err(ContractError::DuplicateCommitment);
        }

        // Enforce max_reports via board
        let count = board.record_commit(&env.current_contract_address(), &request_id);
        if count > request.max_reports {
            return Err(ContractError::MaxReportsReached);
        }

        // Transfer stake from reporter to this contract
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(&reporter, &env.current_contract_address(), &stake);

        // Snapshot weight at commit time
        let weight_bps = rep_info.weight_bps;

        let report = Report {
            reporter: reporter.clone(),
            commitment,
            value: None,
            evidence_hash: None,
            stake,
            weight_bps,
        };

        // Temporary storage for in-flight commitments (TTL extended via worker)
        env.storage().temporary().set(&entry_key, &report);

        // Add reporter to the per-request list so resolve() can iterate.
        // This is done inline in commit() — no separate public function needed.
        let list_key = DataKey::ReportList(request_id);
        let mut reporter_list: Vec<Address> = env
            .storage()
            .temporary()
            .get(&list_key)
            .unwrap_or_else(|| Vec::new(&env));
        reporter_list.push_back(reporter.clone());
        env.storage().temporary().set(&list_key, &reporter_list);
        let list_ttl: u32 = 518_400;
        env.storage()
            .temporary()
            .extend_ttl(&list_key, list_ttl, list_ttl);

        // Track commit count locally
        let count_key = DataKey::CommitCount(request_id);
        let current_count: u32 = env
            .storage()
            .temporary()
            .get(&count_key)
            .unwrap_or(0u32);
        env.storage()
            .temporary()
            .set(&count_key, &(current_count + 1));

        // Extend TTL for this commit (at least until reveal_deadline + 30 days padding)
        // ~518400 ledgers = ~30 days at 5s per ledger
        let ttl: u32 = 518_400;
        env.storage().temporary().extend_ttl(&entry_key, ttl, ttl);
        env.storage().temporary().extend_ttl(&count_key, ttl, ttl);

        CommitEvent {
            request_id,
            reporter,
            stake,
            weight_bps,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Reveal
    // -----------------------------------------------------------------------

    /// Reporter reveals value and salt, verifying against the stored commitment.
    ///
    /// Invariants enforced:
    /// - require_auth on reporter
    /// - between commit_deadline and reveal_deadline
    /// - sha256(value_bytes || salt) == stored commitment
    /// - reject duplicate reveals
    pub fn reveal(
        env: Env,
        reporter: Address,
        request_id: u64,
        value: i128,
        salt: BytesN<32>,
        evidence_hash: BytesN<32>,
    ) -> Result<(), ContractError> {
        reporter.require_auth();

        let board_addr = Self::get_board_addr(&env)?;
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);

        if request.status != RequestStatus::Open && request.status != RequestStatus::Revealing {
            return Err(ContractError::RequestNotRevealable);
        }

        let now = env.ledger().timestamp();
        // Must be after commit deadline
        if now < request.commit_deadline {
            return Err(ContractError::DeadlineNotMet);
        }
        // Must be before reveal deadline
        if now >= request.reveal_deadline {
            return Err(ContractError::DeadlinePassed);
        }

        let entry_key = DataKey::ReportEntry(request_id, reporter.clone());
        let mut report: Report = env
            .storage()
            .temporary()
            .get(&entry_key)
            .ok_or(ContractError::CommitmentNotFound)?;

        // Reject double reveal
        if report.value.is_some() {
            return Err(ContractError::AlreadyRevealed);
        }

        // Verify commitment: sha256(value_i128_le_bytes || salt_32_bytes)
        let hash_bytes = Self::compute_commitment(&env, value, &salt);
        if hash_bytes != report.commitment {
            return Err(ContractError::CommitmentMismatch);
        }

        report.value = Some(value);
        report.evidence_hash = Some(evidence_hash.clone());
        env.storage().temporary().set(&entry_key, &report);

        // Transition request to Revealing status if still Open
        if request.status == RequestStatus::Open {
            board.set_status(
                &env.current_contract_address(),
                &request_id,
                &RequestStatus::Revealing,
            );
        }

        RevealEvent {
            request_id,
            reporter,
            value,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Resolve
    // -----------------------------------------------------------------------

    /// Permissionless resolution after reveal_deadline. Idempotent — runs once per request.
    ///
    /// Steps (per spec):
    /// 1. If revealed < min_reports → cancel, refund bounty, return stakes, slash non-revealers.
    /// 2. Compute reputation-weighted median of revealed values.
    /// 3. Mark reports within tolerance as accepted, others as outliers.
    /// 4. Distribute: protocol_fee → treasury; remainder → accepted reporters pro-rata by weight.
    /// 5. Gentle slash outliers (25% stake); heavy slash non-revealers (50% stake).
    /// 6. Route slashed funds: 50% bonus to accepted, 30% audit fund, 20% treasury.
    /// 7. Update Registry reputation.
    /// 8. Set status to Challengeable; record challenge_window_end.
    ///
    /// Accounting invariant: sum(payouts) + protocol_fee + dust = bounty + sum(all_stakes)
    pub fn resolve(env: Env, request_id: u64) -> Result<ResolutionResult, ContractError> {
        // Idempotency: return early if already resolved
        let res_key = DataKey::Resolution(request_id);
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, ResolutionResult>(&res_key)
        {
            return Ok(existing);
        }

        let board_addr = Self::get_board_addr(&env)?;
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);

        if request.status == RequestStatus::Cancelled
            || request.status == RequestStatus::Finalised
        {
            return Err(ContractError::RequestNotResolvable);
        }
        if request.status == RequestStatus::Challengeable
            || request.status == RequestStatus::Disputed
        {
            return Err(ContractError::RequestAlreadyResolved);
        }

        let now = env.ledger().timestamp();
        if now < request.reveal_deadline {
            return Err(ContractError::DeadlineNotMet);
        }

        let params: EngineParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        let registry_addr = Self::get_registry_addr(&env)?;
        let registry = RegistryClient::new(&env, &registry_addr);
        let token_client = token::Client::new(&env, &request.token);
        let contract_addr = env.current_contract_address();

        // Pull the bounty from RequestBoard escrow into the engine for distribution.
        // All stake funds are already in the engine (transferred at commit time).
        // This must happen first so ALL subsequent transfers can use token_client from engine.
        board.release_funds(
            &contract_addr,
            &request_id,
            &contract_addr,
            &request.bounty,
        );

        // ---------------------------------------------------------------
        // Collect all reports (committed reporters from temp storage)
        // ---------------------------------------------------------------
        let _commit_count: u32 = env
            .storage()
            .temporary()
            .get(&DataKey::CommitCount(request_id))
            .unwrap_or(0);

        // We need the list of reporters — stored in ReportList
        let reporters_list: Vec<Address> = env
            .storage()
            .temporary()
            .get(&DataKey::ReportList(request_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut revealed_reports: [(i128, u32, i128, Address); 15] =
            core::array::from_fn(|_| (0i128, 0u32, 0i128, contract_addr.clone()));
        let mut committed_not_revealed: [Option<(i128, Address)>; 15] =
            core::array::from_fn(|_| None);
        let mut n_revealed: usize = 0;
        let mut n_committed: usize = 0;

        // Iterate reporters list to gather reports
        for i in 0..reporters_list.len() {
            let reporter = reporters_list.get(i).unwrap();
            let entry_key = DataKey::ReportEntry(request_id, reporter.clone());
            if let Some(report) = env
                .storage()
                .temporary()
                .get::<DataKey, Report>(&entry_key)
            {
                if let Some(value) = report.value {
                    if n_revealed < 15 {
                        revealed_reports[n_revealed] =
                            (value, report.weight_bps, report.stake, reporter.clone());
                        n_revealed += 1;
                    }
                } else {
                    // Committed but not revealed
                    if n_committed < 15 {
                        committed_not_revealed[n_committed] =
                            Some((report.stake, reporter.clone()));
                        n_committed += 1;
                    }
                }
            }
        }

        // ---------------------------------------------------------------
        // Under-subscription path
        // ---------------------------------------------------------------
        if n_revealed < request.min_reports as usize {
            // Cancel, refund bounty, return stakes, slash non-revealers
            // Refund bounty to requester
            token_client.transfer(&contract_addr, &request.requester, &request.bounty);

            // Slash non-revealers and return remainder of stakes
            let mut total_slashed_non_reveal: i128 = 0;
            for i in 0..n_committed {
                let (stake, reporter) = committed_not_revealed[i].clone().unwrap();
                let slash = bps_mul(stake, params.non_reveal_slash_bps)?;
                let returned = stake - slash;
                total_slashed_non_reveal += slash;
                if returned > 0 {
                    token_client.transfer(&contract_addr, &reporter, &returned);
                }
                // No revealed reporters to distribute bonus to — slashed goes to treasury + audit fund
                // per the spirit of the split; apply proportionally:
                let audit = bps_mul(slash, SLASH_SPLIT_AUDIT_FUND_BPS)?;
                let treas = slash - audit;
                let treasury_addr: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::TreasuryAddress)
                    .unwrap_or(contract_addr.clone());
                let audit_addr: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::AuditFundAddress)
                    .unwrap_or(contract_addr.clone());
                if audit > 0 {
                    token_client.transfer(&contract_addr, &audit_addr, &audit);
                }
                if treas > 0 {
                    token_client.transfer(&contract_addr, &treasury_addr, &treas);
                }
                // Reputation penalty for non-reveal
                let _ = registry.update_reputation(
                    &contract_addr,
                    &reporter,
                    &REPUTATION_OUTLIER_PENALTY,
                    &false,
                );
            }

            board.set_status(&contract_addr, &request_id, &RequestStatus::Cancelled);

            let result = ResolutionResult {
                median_value: 0,
                confidence_bps: 0,
                n_accepted: 0,
                total_slashed: total_slashed_non_reveal,
                challenge_window_end: 0,
                dust: 0,
            };
            env.storage().persistent().set(&res_key, &result);
            return Ok(result);
        }

        // ---------------------------------------------------------------
        // Compute weighted median
        // ---------------------------------------------------------------
        let mut pairs: [(i128, u32); 15] = [(0, 0); 15];
        for i in 0..n_revealed {
            pairs[i] = (revealed_reports[i].0, revealed_reports[i].1);
        }
        let median_value = weighted_median(&pairs[..n_revealed])?;

        // ---------------------------------------------------------------
        // Classify: accepted vs outlier
        // ---------------------------------------------------------------
        let mut total_accepted_weight: u64 = 0;
        let mut n_accepted: u32 = 0;
        let mut accepted_indices: [bool; 15] = [false; 15];

        for i in 0..n_revealed {
            let (value, weight, _stake, _reporter) = &revealed_reports[i];
            let in_tol = tolerance_check_bps(*value, median_value, request.tolerance_bps)?;
            if in_tol {
                total_accepted_weight += *weight as u64;
                n_accepted += 1;
                accepted_indices[i] = true;
            }
        }

        // Fallback: if no reports are in tolerance (edge case with all tied outliers),
        // accept all — prevents total loss of bounty.
        if n_accepted == 0 {
            for i in 0..n_revealed {
                total_accepted_weight += revealed_reports[i].1 as u64;
                n_accepted += 1;
                accepted_indices[i] = true;
            }
        }

        // ---------------------------------------------------------------
        // Compute confidence_bps (see docs/confidence.md)
        // weight_in_tolerance * 10000 / total_weight, scaled by report quorum factor
        // ---------------------------------------------------------------
        let total_weight: u64 = revealed_reports[..n_revealed]
            .iter()
            .map(|(_, w, _, _)| *w as u64)
            .sum();
        let confidence_bps = if total_weight > 0 {
            let agreement_bps =
                (total_accepted_weight * 10_000 / total_weight).min(10_000) as u32;
            // Quorum factor: min(n_accepted / min_reports, 1.0) expressed in bps
            let quorum_bps = ((n_accepted as u64 * 10_000) / request.min_reports as u64)
                .min(10_000) as u32;
            // Final confidence: geometric-ish mean — (agreement * quorum) / 10000
            (agreement_bps as u64 * quorum_bps as u64 / 10_000).min(10_000) as u32
        } else {
            0
        };

        // ---------------------------------------------------------------
        // Compute slash totals (integer math, dust sink)
        // ---------------------------------------------------------------
        let mut total_slash_outlier: i128 = 0;
        let mut total_slash_non_reveal: i128 = 0;

        // Outlier slashes
        for i in 0..n_revealed {
            if !accepted_indices[i] {
                let stake = revealed_reports[i].2;
                total_slash_outlier += bps_mul(stake, params.outlier_slash_bps)?;
            }
        }
        // Non-reveal slashes
        for i in 0..n_committed {
            let (stake, _reporter) = committed_not_revealed[i].clone().unwrap();
            total_slash_non_reveal += bps_mul(stake, params.non_reveal_slash_bps)?;
        }
        let total_slashed = total_slash_outlier + total_slash_non_reveal;

        // ---------------------------------------------------------------
        // Distribute: protocol_fee from bounty → treasury; remainder to accepted
        // ---------------------------------------------------------------
        let protocol_fee = bps_mul(request.bounty, params.protocol_fee_bps)?;
        let bounty_remainder = request.bounty - protocol_fee;

        // Slash distribution: 50% bonus to accepted, 30% audit fund, 20% treasury
        let slash_bonus_pool = bps_mul(total_slashed, SLASH_SPLIT_BONUS_BPS)?;
        let slash_audit = bps_mul(total_slashed, SLASH_SPLIT_AUDIT_FUND_BPS)?;
        let slash_treasury = total_slashed - slash_bonus_pool - slash_audit;

        // Total pool for accepted reporters = bounty_remainder + slash_bonus_pool
        let total_accepted_pool = bounty_remainder + slash_bonus_pool;

        let treasury_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TreasuryAddress)
            .unwrap_or(contract_addr.clone());
        let audit_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::AuditFundAddress)
            .unwrap_or(contract_addr.clone());

        // Send protocol fee to treasury
        if protocol_fee > 0 {
            token_client.transfer(&contract_addr, &treasury_addr, &protocol_fee);
        }
        // Send slash_treasury share to treasury
        if slash_treasury > 0 {
            token_client.transfer(&contract_addr, &treasury_addr, &slash_treasury);
        }
        // Send slash audit share to audit fund
        if slash_audit > 0 {
            token_client.transfer(&contract_addr, &audit_addr, &slash_audit);
        }

        // ---------------------------------------------------------------
        // Process each reporter: payout or slash
        // ---------------------------------------------------------------
        let mut distributed_to_accepted: i128 = 0;
        let mut dust: i128 = 0;

        for i in 0..n_revealed {
            let (value, weight, stake, reporter) = &revealed_reports[i];
            let entry_key = DataKey::ReportEntry(request_id, reporter.clone());
            let payout_key = DataKey::Payout(request_id, reporter.clone());

            if accepted_indices[i] {
                // Accepted reporter: gets stake back + pro-rata share of accepted pool
                let reward = if total_accepted_weight > 0 {
                    // reward = total_accepted_pool * weight / total_accepted_weight
                    // Use integer math: avoid overflow by dividing first when safe
                    let raw = (*weight as i128)
                        .checked_mul(total_accepted_pool)
                        .ok_or(ContractError::MathOverflow)?;
                    raw / total_accepted_weight as i128
                } else {
                    0
                };
                distributed_to_accepted += reward;
                let claimable = stake + reward;
                env.storage().persistent().set(
                    &payout_key,
                    &PayoutRecord {
                        claimable,
                        claimed: false,
                    },
                );
                // Update reputation: +1 confirmed
                let _ = registry.update_reputation(
                    &contract_addr,
                    reporter,
                    &REPUTATION_CONFIRMED_GAIN,
                    &true,
                );
            } else {
                // Outlier: return (stake - slash), record reduced claimable
                let slash = bps_mul(*stake, params.outlier_slash_bps)?;
                let returned = stake - slash;
                env.storage().persistent().set(
                    &payout_key,
                    &PayoutRecord {
                        claimable: returned,
                        claimed: false,
                    },
                );
                // Update reputation: -5 outlier
                let _ = registry.update_reputation(
                    &contract_addr,
                    reporter,
                    &REPUTATION_OUTLIER_PENALTY,
                    &false,
                );
            }
            // Remove temp storage entry
            env.storage().temporary().remove(&entry_key);
        }

        // Non-revealers: return (stake - slash), payout record
        for i in 0..n_committed {
            let (stake, reporter) = committed_not_revealed[i].clone().unwrap();
            let payout_key = DataKey::Payout(request_id, reporter.clone());
            let slash = bps_mul(stake, params.non_reveal_slash_bps)?;
            let returned = stake - slash;
            env.storage().persistent().set(
                &payout_key,
                &PayoutRecord {
                    claimable: returned,
                    claimed: false,
                },
            );
            // Reputation penalty
            let _ = registry.update_reputation(
                &contract_addr,
                &reporter,
                &REPUTATION_OUTLIER_PENALTY,
                &false,
            );
            let entry_key = DataKey::ReportEntry(request_id, reporter.clone());
            env.storage().temporary().remove(&entry_key);
        }

        // Dust sink: any rounding remainder from accepted pool distribution
        dust = total_accepted_pool - distributed_to_accepted;
        // Dust goes to treasury (per "no rounding leakage beyond dust sink" invariant)
        if dust > 0 {
            token_client.transfer(&contract_addr, &treasury_addr, &dust);
        }

        // Store total accepted weight for claim verification
        env.storage()
            .persistent()
            .set(&DataKey::AcceptedWeight(request_id), &total_accepted_weight);

        // ---------------------------------------------------------------
        // Update request status
        // ---------------------------------------------------------------
        let challenge_window_secs = request.challenge_window;
        let challenge_window_end = now + challenge_window_secs;
        board.set_status(&contract_addr, &request_id, &RequestStatus::Challengeable);

        let result = ResolutionResult {
            median_value,
            confidence_bps,
            n_accepted,
            total_slashed,
            challenge_window_end,
            dust,
        };

        env.storage().persistent().set(&res_key, &result);
        // Extend TTL for resolution data (persistent, extend 1 year padding)
        let persistent_ttl: u32 = 6_307_200; // ~1 year in ledgers
        env.storage()
            .persistent()
            .extend_ttl(&res_key, persistent_ttl, persistent_ttl);

        ResolvedEvent {
            request_id,
            median_value,
            n_accepted,
            confidence_bps,
        }
        .publish(&env);

        Ok(result)
    }

    // -----------------------------------------------------------------------
    // Claim
    // -----------------------------------------------------------------------

    /// Reporter claims their payout (stake return + reward) exactly once.
    pub fn claim(env: Env, reporter: Address, request_id: u64) -> Result<i128, ContractError> {
        reporter.require_auth();

        let payout_key = DataKey::Payout(request_id, reporter.clone());
        let mut record: PayoutRecord = env
            .storage()
            .persistent()
            .get(&payout_key)
            .ok_or(ContractError::NothingToClaim)?;

        if record.claimed {
            return Err(ContractError::AlreadyClaimed);
        }
        if record.claimable == 0 {
            return Err(ContractError::NothingToClaim);
        }

        record.claimed = true;
        env.storage().persistent().set(&payout_key, &record);

        // Fetch token from request
        let board_addr = Self::get_board_addr(&env)?;
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);

        let token_client = token::Client::new(&env, &request.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &reporter, &record.claimable);

        ClaimedEvent {
            request_id,
            reporter,
            amount: record.claimable,
        }
        .publish(&env);

        Ok(record.claimable)
    }

    // -----------------------------------------------------------------------
    // Finalise
    // -----------------------------------------------------------------------

    /// After the challenge window with no dispute, writes Observation to OracleFeed.
    pub fn finalise(env: Env, request_id: u64) -> Result<(), ContractError> {
        let board_addr = Self::get_board_addr(&env)?;
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);

        if request.status != RequestStatus::Challengeable {
            return Err(ContractError::RequestNotFinalisable);
        }

        let res_key = DataKey::Resolution(request_id);
        let resolution: ResolutionResult = env
            .storage()
            .persistent()
            .get(&res_key)
            .ok_or(ContractError::RequestNotResolvable)?;

        let now = env.ledger().timestamp();
        if now < resolution.challenge_window_end {
            return Err(ContractError::ChallengeWindowActive);
        }

        let obs = Observation {
            request_id,
            data_type: request.data_type,
            geohash: request.geohash,
            value: resolution.median_value,
            confidence_bps: resolution.confidence_bps,
            n_reports: resolution.n_accepted,
            finalised_at: now,
        };

        // Write to OracleFeed
        let feed_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleFeedAddress)
            .ok_or(ContractError::NotInitialized)?;
        let feed = OracleFeedClient::new(&env, &feed_addr);
        feed.write_observation(&env.current_contract_address(), &obs);

        board.set_status(
            &env.current_contract_address(),
            &request_id,
            &RequestStatus::Finalised,
        );

        FinalisedEvent {
            request_id,
            median_value: resolution.median_value,
            finalised_at: now,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Fraud hook (callable only by Disputes)
    // -----------------------------------------------------------------------

    /// Applies full slash to a reporter for proven fraud.
    /// Only the Disputes contract (stored at DisputesAddress) may call this.
    pub fn apply_fraud_slash(
        env: Env,
        caller: Address,
        reporter: Address,
        request_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_disputes_caller(&env, &caller)?;

        let payout_key = DataKey::Payout(request_id, reporter.clone());
        let mut record: PayoutRecord = env
            .storage()
            .persistent()
            .get(&payout_key)
            .ok_or(ContractError::NothingToClaim)?;

        if record.claimed {
            // If already claimed, there's no recoverable funds here (race condition handled by
            // dispute timing — disputes must be filed before claim). Log as zero-slash.
            FraudSlashAppliedEvent {
                request_id,
                reporter,
                slash_amount: 0,
            }
            .publish(&env);
            return Ok(());
        }

        let slash_amount = record.claimable;
        record.claimable = 0;
        record.claimed = true; // prevent future claim
        env.storage().persistent().set(&payout_key, &record);

        // Route slash: 50% bonus pool (no accepted reporters to give to here — send to audit),
        // 30% audit fund, 20% treasury
        let board_addr = Self::get_board_addr(&env)?;
        let board = RequestBoardClient::new(&env, &board_addr);
        let request = board.get_request(&request_id);
        let token_client = token::Client::new(&env, &request.token);
        let contract_addr = env.current_contract_address();

        let audit_share = bps_mul(slash_amount, SLASH_SPLIT_AUDIT_FUND_BPS)?;
        let bonus_share = bps_mul(slash_amount, SLASH_SPLIT_BONUS_BPS)?;
        let treasury_share = slash_amount - audit_share - bonus_share;

        let audit_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::AuditFundAddress)
            .unwrap_or(contract_addr.clone());
        let treasury_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TreasuryAddress)
            .unwrap_or(contract_addr.clone());

        // Bonus share also goes to audit fund (no specific beneficiary without re-resolving)
        let total_audit = audit_share + bonus_share;
        if total_audit > 0 {
            token_client.transfer(&contract_addr, &audit_addr, &total_audit);
        }
        if treasury_share > 0 {
            token_client.transfer(&contract_addr, &treasury_addr, &treasury_share);
        }

        // Registry: reset reputation to banned + trigger voucher liability
        let registry_addr = Self::get_registry_addr(&env)?;
        let registry = RegistryClient::new(&env, &registry_addr);
        let _ = registry.reset_reputation_fraud(&contract_addr, &reporter);

        let params: EngineParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();
        let _ = registry.slash_voucher(
            &contract_addr,
            &reporter,
            &params.voucher_slash_fraction_bps,
        );

        FraudSlashAppliedEvent {
            request_id,
            reporter,
            slash_amount,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_payout(
        env: Env,
        reporter: Address,
        request_id: u64,
    ) -> Option<PayoutRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Payout(request_id, reporter))
    }

    pub fn get_resolution(env: Env, request_id: u64) -> Option<ResolutionResult> {
        env.storage()
            .persistent()
            .get(&DataKey::Resolution(request_id))
    }

    pub fn get_report(
        env: Env,
        reporter: Address,
        request_id: u64,
    ) -> Option<Report> {
        env.storage()
            .temporary()
            .get(&DataKey::ReportEntry(request_id, reporter))
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    pub fn set_params(
        env: Env,
        admin: Address,
        params: EngineParams,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Params, &params);
        Ok(())
    }

    pub fn set_disputes_address(
        env: Env,
        admin: Address,
        disputes: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::DisputesAddress, &disputes);
        Ok(())
    }

    pub fn set_authorized_caller(
        env: Env,
        admin: Address,
        caller: Address,
        authorized: bool,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(caller), &authorized);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Computes sha256(value_le_bytes || salt_bytes) for commitment verification.
    fn compute_commitment(env: &Env, value: i128, salt: &BytesN<32>) -> BytesN<32> {
        let mut preimage = soroban_sdk::Bytes::new(env);
        // Encode value as 16-byte little-endian
        let value_bytes = value.to_le_bytes();
        for b in value_bytes {
            preimage.push_back(b);
        }
        // Append 32-byte salt
        for i in 0..32u32 {
            preimage.push_back(salt.get(i).unwrap());
        }
        env.crypto().sha256(&preimage).into()
    }

    fn get_registry_addr(env: &Env) -> Result<Address, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::RegistryAddress)
            .ok_or(ContractError::NotInitialized)
    }

    fn get_board_addr(env: &Env) -> Result<Address, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::RequestBoardAddress)
            .ok_or(ContractError::NotInitialized)
    }

    fn assert_admin(env: &Env, address: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if &admin != address {
            Err(ContractError::Unauthorized)
        } else {
            Ok(())
        }
    }

    fn assert_authorized(env: &Env, address: &Address) -> Result<(), ContractError> {
        let is_auth: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedCaller(address.clone()))
            .unwrap_or(false);
        if !is_auth {
            Err(ContractError::Unauthorized)
        } else {
            Ok(())
        }
    }

    fn assert_disputes_caller(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let disputes_addr: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::DisputesAddress);
        match disputes_addr {
            Some(addr) if &addr == caller => Ok(()),
            _ => Err(ContractError::Unauthorized),
        }
    }
}

#[cfg(test)]
mod test;
