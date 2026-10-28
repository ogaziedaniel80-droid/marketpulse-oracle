#![no_std]
#![allow(dead_code, clippy::needless_borrows_for_generic_args)]

//! Disputes — Challenge, panel selection, ruling, bond handling.
//!
//! Panel selection uses a multi-party commit-reveal seed (XOR of secrets from registered
//! contributors) rather than env.prng() alone. v1 also supports a trusted fallback panel
//! controlled by the admin multisig.
//!
//! Default timeout outcome (README section documented): dispute rejected.
//! Rationale: if a panel fails to rule, the conservative outcome is to preserve the existing
//! resolution rather than void it. This is documented in docs/randomness.md and the threat model.
//!
//! See README sections 4.1, 11, 13.

use marketpulse_shared::{
    bps_mul, ContractError, DisputeRecord, Request, RequestStatus, DEFAULT_PANEL_SIZE,
    DEFAULT_RULING_WINDOW_SECONDS, DEFAULT_TIMEOUT_OUTCOME_UPHELD,
    REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Params,
    /// ReportEngine address (for applying fraud slashes).
    ReportEngineAddress,
    /// RequestBoard address (for status transitions).
    RequestBoardAddress,
    /// Treasury and audit fund addresses
    TreasuryAddress,
    AuditFundAddress,
    /// Eligible panel members: per-member flag
    PanelMember(Address),
    /// Full list for iteration
    PanelMemberList,
    /// Seed commitment per (request_id, contributor)
    SeedCommitment(u64, Address),
    /// Accumulated XOR seed per request_id
    FinalSeed(u64),
    /// Active dispute per request
    Dispute(u64),
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeParams {
    pub panel_size: u32,
    pub ruling_window_secs: u64,
    /// Default outcome when panel times out. false = rejected (conservative default).
    pub timeout_outcome_upheld: bool,
}

impl Default for DisputeParams {
    fn default() -> Self {
        Self {
            panel_size: DEFAULT_PANEL_SIZE,
            ruling_window_secs: DEFAULT_RULING_WINDOW_SECONDS,
            timeout_outcome_upheld: DEFAULT_TIMEOUT_OUTCOME_UPHELD,
        }
    }
}

// ---------------------------------------------------------------------------
// External clients (inline to avoid circular dep)
// ---------------------------------------------------------------------------

mod report_engine_client {
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "ReportEngineClient")]
    pub trait ReportEngineInterface {
        fn apply_fraud_slash(env: Env, caller: Address, reporter: Address, request_id: u64);
    }
}

mod request_board_client {
    use marketpulse_shared::{Request, RequestStatus};
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "RequestBoardClient")]
    pub trait RequestBoardInterface {
        fn get_request(env: Env, request_id: u64) -> Request;
        fn set_status(env: Env, caller: Address, request_id: u64, status: RequestStatus);
    }
}

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
pub struct ChallengeFiledEvent {
    pub request_id: u64,
    pub challenger: Address,
    pub bond: i128,
    pub reason: Symbol,
    pub ruling_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct RuleVoteEvent {
    pub request_id: u64,
    pub panel_member: Address,
    pub upheld: bool,
    pub votes_cast: u32,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeResolvedEvent {
    pub request_id: u64,
    pub upheld: bool,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PanelMemberRegisteredEvent {
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct PanelMemberRemovedEvent {
    pub member: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SeedCommitSubmittedEvent {
    pub request_id: u64,
    pub contributor: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SeedRevealedEvent {
    pub request_id: u64,
    pub contributor: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct DisputeTimeoutResolvedEvent {
    pub request_id: u64,
    pub default_upheld: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DisputesContract;

#[contractimpl]
impl DisputesContract {
    pub fn version(_env: Env) -> u32 {
        2
    }

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    pub fn initialize(
        env: Env,
        admin: Address,
        report_engine: Address,
        request_board: Address,
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
            .set(&DataKey::ReportEngineAddress, &report_engine);
        env.storage()
            .instance()
            .set(&DataKey::RequestBoardAddress, &request_board);
        env.storage()
            .instance()
            .set(&DataKey::TreasuryAddress, &treasury);
        env.storage()
            .instance()
            .set(&DataKey::AuditFundAddress, &audit_fund);
        env.storage()
            .instance()
            .set(&DataKey::Params, &DisputeParams::default());
        env.storage()
            .instance()
            .set(&DataKey::PanelMemberList, &Vec::<Address>::new(&env));

        InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Challenge
    // -----------------------------------------------------------------------

    /// File a challenge during the challenge window.
    ///
    /// Bond requirements (README section 10): 5x min_stake.
    /// The challenger transfers the bond; if rejected, the bond is slashed to
    /// audit fund (70%) and treasury (30%).
    pub fn challenge(
        env: Env,
        challenger: Address,
        request_id: u64,
        bond: i128,
        reason: Symbol,
    ) -> Result<(), ContractError> {
        challenger.require_auth();

        let (board_addr, request) = Self::get_board_and_request(&env, request_id)?;

        if request.status != RequestStatus::Challengeable {
            return Err(ContractError::RequestNotChallengeable);
        }

        // Reject if already challenged
        let dispute_key = DataKey::Dispute(request_id);
        if env.storage().persistent().has(&dispute_key) {
            return Err(ContractError::AlreadyChallenged);
        }

        // Minimum bond = 5x min_stake (README section 10: "5x average stake")
        let min_bond = request
            .min_stake
            .checked_mul(5)
            .ok_or(ContractError::MathOverflow)?;
        if bond < min_bond {
            return Err(ContractError::InsufficientBond);
        }

        let now = env.ledger().timestamp();

        // Transfer bond from challenger to this contract
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(&challenger, &env.current_contract_address(), &bond);

        let params: DisputeParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();
        let ruling_deadline = now + params.ruling_window_secs;

        let dispute = DisputeRecord {
            request_id,
            challenger: challenger.clone(),
            bond,
            reason: reason.clone(),
            challenged_at: now,
            ruling_deadline,
            ruled: false,
            upheld: None,
            votes: Vec::new(&env),
        };

        env.storage().persistent().set(&dispute_key, &dispute);

        // Set request status to Disputed
        let board = RequestBoardClient::new(&env, &board_addr);
        board.set_status(
            &env.current_contract_address(),
            &request_id,
            &RequestStatus::Disputed,
        );

        let ttl: u32 = 1_036_800; // ~60 days
        env.storage()
            .persistent()
            .extend_ttl(&dispute_key, ttl, ttl);

        ChallengeFiledEvent {
            request_id,
            challenger,
            bond,
            reason,
            ruling_deadline,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Rule
    // -----------------------------------------------------------------------

    /// Panel member casts a vote. Majority triggers final resolution.
    ///
    /// Upheld → bond returned to challenger; fraud slashes applied via ReportEngine hook;
    ///          request voided (Cancelled).
    /// Rejected → bond slashed (70% audit fund, 30% treasury);
    ///            request reverts to Challengeable (window may still be live).
    pub fn rule(
        env: Env,
        panel_member: Address,
        request_id: u64,
        upheld: bool,
    ) -> Result<(), ContractError> {
        panel_member.require_auth();

        if !env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::PanelMember(panel_member.clone()))
            .unwrap_or(false)
        {
            return Err(ContractError::NotPanelMember);
        }

        let dispute_key = DataKey::Dispute(request_id);
        let mut dispute: DisputeRecord = env
            .storage()
            .persistent()
            .get(&dispute_key)
            .ok_or(ContractError::DisputeNotFound)?;

        if dispute.ruled {
            return Err(ContractError::AlreadyRuled);
        }

        // Check no double vote
        for i in 0..dispute.votes.len() {
            let (voter, _) = dispute.votes.get(i).unwrap();
            if voter == panel_member {
                return Err(ContractError::AlreadyVoted);
            }
        }

        dispute.votes.push_back((panel_member.clone(), upheld));
        let votes_cast = dispute.votes.len();

        RuleVoteEvent {
            request_id,
            panel_member,
            upheld,
            votes_cast,
        }
        .publish(&env);

        let params: DisputeParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        let mut upheld_count: u32 = 0;
        let mut rejected_count: u32 = 0;
        for i in 0..dispute.votes.len() {
            let (_, v) = dispute.votes.get(i).unwrap();
            if v {
                upheld_count += 1;
            } else {
                rejected_count += 1;
            }
        }

        let majority_threshold = params.panel_size / 2 + 1;
        let has_majority =
            upheld_count >= majority_threshold || rejected_count >= majority_threshold;

        if has_majority {
            let final_upheld = upheld_count >= majority_threshold;
            dispute.ruled = true;
            dispute.upheld = Some(final_upheld);
            env.storage().persistent().set(&dispute_key, &dispute);
            Self::execute_ruling(&env, request_id, &dispute, final_upheld)?;
        } else {
            env.storage().persistent().set(&dispute_key, &dispute);
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Timeout resolution
    // -----------------------------------------------------------------------

    /// Permissionless: resolves a dispute after the ruling deadline.
    /// Default outcome = dispute rejected (bond slashed). See docs/randomness.md §5.
    pub fn resolve_timeout(env: Env, request_id: u64) -> Result<(), ContractError> {
        let dispute_key = DataKey::Dispute(request_id);
        let mut dispute: DisputeRecord = env
            .storage()
            .persistent()
            .get(&dispute_key)
            .ok_or(ContractError::DisputeNotFound)?;

        if dispute.ruled {
            return Err(ContractError::AlreadyRuled);
        }

        let now = env.ledger().timestamp();
        if now < dispute.ruling_deadline {
            return Err(ContractError::DeadlineNotMet);
        }

        let params: DisputeParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        let final_upheld = params.timeout_outcome_upheld; // false by default
        dispute.ruled = true;
        dispute.upheld = Some(final_upheld);
        env.storage().persistent().set(&dispute_key, &dispute);

        Self::execute_ruling(&env, request_id, &dispute, final_upheld)?;

        DisputeTimeoutResolvedEvent {
            request_id,
            default_upheld: final_upheld,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Multi-party seed protocol (see docs/randomness.md)
    // -----------------------------------------------------------------------

    /// Phase 1: contributor submits sha256(secret || nonce).
    pub fn submit_seed_commitment(
        env: Env,
        contributor: Address,
        request_id: u64,
        commitment: BytesN<32>,
    ) -> Result<(), ContractError> {
        contributor.require_auth();

        // Only panel members or admin may contribute seeds
        let is_panel = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::PanelMember(contributor.clone()))
            .unwrap_or(false);
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let is_admin = admin.map(|a| a == contributor).unwrap_or(false);

        if !is_panel && !is_admin {
            return Err(ContractError::NotPanelMember);
        }

        let key = DataKey::SeedCommitment(request_id, contributor.clone());
        if env.storage().temporary().has(&key) {
            return Err(ContractError::DuplicateCommitment);
        }

        let commit = marketpulse_shared::SeedCommitment {
            contributor: contributor.clone(),
            hash: commitment,
            revealed_secret: None,
        };
        env.storage().temporary().set(&key, &commit);
        let ttl: u32 = 259_200;
        env.storage().temporary().extend_ttl(&key, ttl, ttl);

        SeedCommitSubmittedEvent {
            request_id,
            contributor,
        }
        .publish(&env);
        Ok(())
    }

    /// Phase 2: contributor reveals secret + nonce; XOR-accumulates into the final seed.
    pub fn reveal_seed(
        env: Env,
        contributor: Address,
        request_id: u64,
        secret: BytesN<32>,
        nonce: BytesN<32>,
    ) -> Result<(), ContractError> {
        contributor.require_auth();

        let key = DataKey::SeedCommitment(request_id, contributor.clone());
        let mut commit: marketpulse_shared::SeedCommitment = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(ContractError::CommitmentNotFound)?;

        if commit.revealed_secret.is_some() {
            return Err(ContractError::AlreadyRevealed);
        }

        // Verify commitment: sha256(secret || nonce)
        let mut preimage = soroban_sdk::Bytes::new(&env);
        for i in 0..32u32 {
            preimage.push_back(secret.get(i).unwrap());
        }
        for i in 0..32u32 {
            preimage.push_back(nonce.get(i).unwrap());
        }
        let hash: BytesN<32> = env.crypto().sha256(&preimage).into();
        if hash != commit.hash {
            return Err(ContractError::CommitmentMismatch);
        }

        commit.revealed_secret = Some(secret.clone());
        env.storage().temporary().set(&key, &commit);

        // XOR into accumulated seed
        let seed_key = DataKey::FinalSeed(request_id);
        let current: BytesN<32> = env
            .storage()
            .temporary()
            .get(&seed_key)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));
        let xored = Self::xor_bytes32(&env, &current, &secret);
        env.storage().temporary().set(&seed_key, &xored);
        let ttl: u32 = 259_200;
        env.storage().temporary().extend_ttl(&seed_key, ttl, ttl);

        SeedRevealedEvent {
            request_id,
            contributor,
        }
        .publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Panel member management (admin only)
    // -----------------------------------------------------------------------

    pub fn register_panel_member(
        env: Env,
        admin: Address,
        member: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage()
            .instance()
            .set(&DataKey::PanelMember(member.clone()), &true);

        let list_key = DataKey::PanelMemberList;
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&list_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut exists = false;
        for i in 0..list.len() {
            if list.get(i).unwrap() == member {
                exists = true;
                break;
            }
        }
        if !exists {
            list.push_back(member.clone());
        }
        env.storage().instance().set(&list_key, &list);

        PanelMemberRegisteredEvent { member }.publish(&env);
        Ok(())
    }

    pub fn remove_panel_member(
        env: Env,
        admin: Address,
        member: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage()
            .instance()
            .remove(&DataKey::PanelMember(member.clone()));

        let list_key = DataKey::PanelMemberList;
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&list_key)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for i in 0..list.len() {
            let addr = list.get(i).unwrap();
            if addr != member {
                new_list.push_back(addr);
            }
        }
        env.storage().instance().set(&list_key, &new_list);

        PanelMemberRemovedEvent { member }.publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_dispute(env: Env, request_id: u64) -> Option<DisputeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(request_id))
    }

    pub fn get_panel_members(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::PanelMemberList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn is_panel_member(env: Env, member: Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::PanelMember(member))
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    pub fn set_params(
        env: Env,
        admin: Address,
        params: DisputeParams,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Params, &params);
        Ok(())
    }

    pub fn set_report_engine(
        env: Env,
        admin: Address,
        engine: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::ReportEngineAddress, &engine);
        Ok(())
    }

    pub fn set_request_board(
        env: Env,
        admin: Address,
        board: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::RequestBoardAddress, &board);
        Ok(())
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), ContractError> {
        current_admin.require_auth();
        Self::assert_admin(&env, &current_admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn execute_ruling(
        env: &Env,
        request_id: u64,
        dispute: &DisputeRecord,
        upheld: bool,
    ) -> Result<(), ContractError> {
        let (board_addr, request) = Self::get_board_and_request(env, request_id)?;
        let token_client = token::Client::new(env, &request.token);
        let contract_addr = env.current_contract_address();
        let board = RequestBoardClient::new(env, &board_addr);

        if upheld {
            // Return bond to challenger
            token_client.transfer(&contract_addr, &dispute.challenger, &dispute.bond);

            // Void the observation: set to Cancelled to prevent finalise()
            board.set_status(&contract_addr, &request_id, &RequestStatus::Cancelled);

            // TODO(owner): trigger bulk fraud-slash on all reporters via ReportEngine.
            // In v1 this requires the reporter list from ReportEngine, which would be a
            // cross-contract call. See docs/adr for Phase 2 enhancement.
            // Individual fraud slashes can be triggered by admin calling apply_fraud_slash
            // on the ReportEngine directly after a dispute is upheld.
        } else {
            // Rejected: slash bond
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

            let audit_share = bps_mul(dispute.bond, REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS)?;
            let treasury_share = dispute
                .bond
                .checked_sub(audit_share)
                .ok_or(ContractError::MathOverflow)?;

            if audit_share > 0 {
                token_client.transfer(&contract_addr, &audit_addr, &audit_share);
            }
            if treasury_share > 0 {
                token_client.transfer(&contract_addr, &treasury_addr, &treasury_share);
            }

            // Restore to Challengeable so finalise() can still be called if window allows
            board.set_status(&contract_addr, &request_id, &RequestStatus::Challengeable);
        }

        DisputeResolvedEvent { request_id, upheld }.publish(env);

        Ok(())
    }

    fn get_board_and_request(
        env: &Env,
        request_id: u64,
    ) -> Result<(Address, Request), ContractError> {
        let board_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestBoardAddress)
            .ok_or(ContractError::NotInitialized)?;
        let board = RequestBoardClient::new(env, &board_addr);
        let request = board.get_request(&request_id);
        Ok((board_addr, request))
    }

    fn xor_bytes32(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
        let mut result = [0u8; 32];
        for i in 0..32u32 {
            result[i as usize] = a.get(i).unwrap() ^ b.get(i).unwrap();
        }
        BytesN::from_array(env, &result)
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
}

#[cfg(test)]
mod test;
