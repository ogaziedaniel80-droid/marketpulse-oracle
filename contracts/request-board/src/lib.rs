#![no_std]

use marketpulse_shared::{
    ContractError, Request, RequestParams, RequestStatus, DEFAULT_MAX_REPORTS_CAP,
    DEFAULT_MIN_BOUNTY, DEFAULT_MIN_STAKE_NEW_REPORTER, MAX_CURSOR_LIMIT,
    MIN_CHALLENGE_WINDOW_SECONDS,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol,
    Vec,
};

#[contracttype]
pub enum DataKey {
    Admin,
    AuthorizedCaller(Address),
    NextRequestId,
    Request(u64),
    RequestCommitCount(u64),
    ApprovedDataType(Symbol),
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub requester: Address,
    pub data_type: Symbol,
    pub bounty: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestCancelledEvent {
    pub request_id: u64,
    pub reason: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataTypeAddedEvent {
    pub data_type: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DataTypeRemovedEvent {
    pub data_type: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitRecordedEvent {
    pub request_id: u64,
    pub new_count: u32,
}

#[contract]
pub struct RequestBoardContract;

#[contractimpl]
impl RequestBoardContract {
    pub fn version(_env: Env) -> u32 {
        1
    }

    /// Initializes RequestBoard with admin and seeds the launch data types from README 9.1.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(admin.clone()), &true);
        env.storage().instance().set(&DataKey::NextRequestId, &1u64);

        // Seed approved launch data types from README section 9.1:
        // RICE50, GARRI, MAIZE, TOMATO, FUEL_PMS, FUEL_DSL
        let launch_types = [
            Symbol::new(&env, "RICE50"),
            Symbol::new(&env, "GARRI"),
            Symbol::new(&env, "MAIZE"),
            Symbol::new(&env, "TOMATO"),
            Symbol::new(&env, "FUEL_PMS"),
            Symbol::new(&env, "FUEL_DSL"),
        ];

        for dt in launch_types {
            env.storage()
                .persistent()
                .set(&DataKey::ApprovedDataType(dt), &true);
        }

        InitializedEvent { admin }.publish(&env);

        Ok(())
    }

    /// Creates a new data request, escrows USDC bounty, and returns request ID.
    pub fn create_request(
        env: Env,
        requester: Address,
        params: RequestParams,
    ) -> Result<u64, ContractError> {
        requester.require_auth();

        // Parameter validations
        if !Self::is_approved_data_type(env.clone(), params.data_type.clone()) {
            return Err(ContractError::UnsupportedDataType);
        }

        if params.bounty < DEFAULT_MIN_BOUNTY {
            return Err(ContractError::BountyTooLow);
        }

        if params.min_stake < DEFAULT_MIN_STAKE_NEW_REPORTER {
            return Err(ContractError::StakeTooLow);
        }

        let now = env.ledger().timestamp();
        if params.commit_deadline <= now {
            return Err(ContractError::DeadlinePassed);
        }

        if params.reveal_deadline <= params.commit_deadline {
            return Err(ContractError::InvalidDeadlineOrder);
        }

        if params.challenge_window < MIN_CHALLENGE_WINDOW_SECONDS {
            return Err(ContractError::InvalidParameter);
        }

        if params.min_reports < 3 {
            return Err(ContractError::MinReportsTooLow);
        }

        if params.max_reports > DEFAULT_MAX_REPORTS_CAP {
            return Err(ContractError::MaxReportsExceedsCap);
        }

        if params.min_reports > params.max_reports {
            return Err(ContractError::MinReportsExceedsMax);
        }

        if params.tolerance_bps < 50 || params.tolerance_bps > 3_000 {
            return Err(ContractError::InvalidToleranceBps);
        }

        // Transfer USDC bounty from requester to contract escrow
        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &params.token);
        token_client.transfer(&requester, &contract_addr, &params.bounty);

        // Allocate request ID
        let request_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestId)
            .unwrap_or(1);

        env.storage()
            .instance()
            .set(&DataKey::NextRequestId, &(request_id + 1));

        let request = Request {
            id: request_id,
            requester: requester.clone(),
            data_type: params.data_type.clone(),
            geohash: params.geohash,
            bounty: params.bounty,
            token: params.token,
            min_stake: params.min_stake,
            tolerance_bps: params.tolerance_bps,
            commit_deadline: params.commit_deadline,
            reveal_deadline: params.reveal_deadline,
            challenge_window: params.challenge_window,
            min_reports: params.min_reports,
            max_reports: params.max_reports,
            status: RequestStatus::Open,
        };

        // Storage TTL Strategy:
        // Persistent storage ensures durability throughout request resolution & dispute windows.
        // TTL is extended for active records to prevent eviction.
        let key = DataKey::Request(request_id);
        env.storage().persistent().set(&key, &request);
        env.storage()
            .persistent()
            .set(&DataKey::RequestCommitCount(request_id), &0u32);

        // Extend TTL: live for at least the full reveal + challenge window + 14 days margin
        let ttl_extension_ledgers = 250_000; // ~14 days at 5s ledger closes
        env.storage()
            .persistent()
            .extend_ttl(&key, ttl_extension_ledgers, ttl_extension_ledgers);

        RequestCreatedEvent {
            request_id,
            requester,
            data_type: params.data_type,
            bounty: params.bounty,
        }
        .publish(&env);

        Ok(request_id)
    }

    /// Cancels request before any commitments exist, refunding the requester in full.
    pub fn cancel_request(
        env: Env,
        requester: Address,
        request_id: u64,
    ) -> Result<(), ContractError> {
        requester.require_auth();

        let req_key = DataKey::Request(request_id);
        let mut request: Request = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)?;

        if request.requester != requester {
            return Err(ContractError::Unauthorized);
        }

        if request.status != RequestStatus::Open {
            return Err(ContractError::RequestCannotBeCancelled);
        }

        let commit_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::RequestCommitCount(request_id))
            .unwrap_or(0);

        if commit_count > 0 {
            return Err(ContractError::CommitmentsExist);
        }

        // Full refund to requester
        request.status = RequestStatus::Cancelled;
        env.storage().persistent().set(&req_key, &request);

        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(&contract_addr, &request.requester, &request.bounty);

        RequestCancelledEvent {
            request_id,
            reason: symbol_short!("requester"),
        }
        .publish(&env);

        Ok(())
    }

    /// Under-subscription refund path:
    /// Cancels and refunds when commit deadline passes with fewer than min_reports commitments.
    /// Can be called permissionlessly by any caller or ReportEngine.
    pub fn cancel_undersubscribed(
        env: Env,
        caller: Address,
        request_id: u64,
        commit_count: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let req_key = DataKey::Request(request_id);
        let mut request: Request = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)?;

        if request.status != RequestStatus::Open {
            return Err(ContractError::RequestCannotBeCancelled);
        }

        let now = env.ledger().timestamp();
        if now <= request.commit_deadline {
            return Err(ContractError::DeadlineNotMet);
        }

        if commit_count >= request.min_reports {
            return Err(ContractError::NotUnderSubscribed);
        }

        request.status = RequestStatus::Cancelled;
        env.storage().persistent().set(&req_key, &request);

        // Refund requester in full
        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(&contract_addr, &request.requester, &request.bounty);

        RequestCancelledEvent {
            request_id,
            reason: symbol_short!("undersub"),
        }
        .publish(&env);

        Ok(())
    }

    /// Records that a commitment was made (called by authorized caller such as ReportEngine).
    pub fn record_commit(env: Env, caller: Address, request_id: u64) -> Result<u32, ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let req_key = DataKey::Request(request_id);
        let request: Request = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)?;

        if request.status != RequestStatus::Open {
            return Err(ContractError::RequestNotOpen);
        }

        let count_key = DataKey::RequestCommitCount(request_id);
        let current_count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

        if current_count >= request.max_reports {
            return Err(ContractError::MaxReportsReached);
        }

        let new_count = current_count + 1;
        env.storage().persistent().set(&count_key, &new_count);

        CommitRecordedEvent {
            request_id,
            new_count,
        }
        .publish(&env);

        Ok(new_count)
    }

    /// Updates status of a request (authorized callers only).
    pub fn set_status(
        env: Env,
        caller: Address,
        request_id: u64,
        status: RequestStatus,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let req_key = DataKey::Request(request_id);
        let mut request: Request = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)?;

        request.status = status;
        env.storage().persistent().set(&req_key, &request);

        Ok(())
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    pub fn get_request(env: Env, request_id: u64) -> Result<Request, ContractError> {
        let req_key = DataKey::Request(request_id);
        env.storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)
    }

    pub fn request_status(env: Env, request_id: u64) -> Result<RequestStatus, ContractError> {
        let req = Self::get_request(env, request_id)?;
        Ok(req.status)
    }

    pub fn is_approved_data_type(env: Env, data_type: Symbol) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ApprovedDataType(data_type))
            .unwrap_or(false)
    }

    /// Lists open requests with cursor and limit pagination.
    pub fn list_open_requests(env: Env, cursor: u64, limit: u32) -> Vec<Request> {
        let bounded_limit = limit.min(MAX_CURSOR_LIMIT);
        let total_requests: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRequestId)
            .unwrap_or(1);

        let mut results = Vec::new(&env);
        let start = cursor.max(1);

        for id in start..total_requests {
            if results.len() >= bounded_limit {
                break;
            }
            if let Some(req) = env
                .storage()
                .persistent()
                .get::<DataKey, Request>(&DataKey::Request(id))
            {
                if req.status == RequestStatus::Open {
                    results.push_back(req);
                }
            }
        }

        results
    }

    // -------------------------------------------------------------------------
    // Admin functions
    // -------------------------------------------------------------------------

    pub fn add_data_type(env: Env, admin: Address, data_type: Symbol) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::ApprovedDataType(data_type.clone()), &true);

        DataTypeAddedEvent { data_type }.publish(&env);

        Ok(())
    }

    pub fn remove_data_type(
        env: Env,
        admin: Address,
        data_type: Symbol,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .remove(&DataKey::ApprovedDataType(data_type.clone()));

        DataTypeRemovedEvent { data_type }.publish(&env);

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
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(new_admin), &true);

        Ok(())
    }

    /// Authorized caller (ReportEngine) transfers `amount` from the board's escrow to `recipient`.
    /// Used during resolve() to pay out bounty shares, treasury fee, audit fund, etc.
    pub fn release_funds(
        env: Env,
        caller: Address,
        request_id: u64,
        recipient: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        if amount <= 0 {
            return Ok(()); // no-op for zero/negative amounts
        }

        let req_key = DataKey::Request(request_id);
        let request: Request = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(ContractError::RequestNotFound)?;

        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(&contract_addr, &recipient, &amount);

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

    fn assert_admin(env: &Env, address: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if &admin != address {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn assert_authorized(env: &Env, address: &Address) -> Result<(), ContractError> {
        let is_auth: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedCaller(address.clone()))
            .unwrap_or(false);
        if !is_auth {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
