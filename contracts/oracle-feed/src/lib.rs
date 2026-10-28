#![no_std]

//! OracleFeed — Read-only consumer interface for finalised observations.
//!
//! Write access is restricted to the registered ReportEngine address.
//! History is bounded at MAX_HISTORY_LENGTH per (data_type, geohash) key.
//! Pruning is FIFO: when the bound is exceeded the oldest entry is removed.
//! See README sections 8.3 and 20.

use marketpulse_shared::{ContractError, Observation, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LENGTH};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, BytesN, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    /// Address authorised to write observations (the ReportEngine).
    WriterAddress,
    /// Latest observation for (data_type_str, geohash_bytes)
    Latest(Symbol, BytesN<8>),
    /// History list for (data_type_str, geohash_bytes). Stored as Vec<Observation>.
    History(Symbol, BytesN<8>),
}

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
pub struct ObservationWrittenEvent {
    pub request_id: u64,
    pub data_type: Symbol,
    pub value: i128,
    pub confidence_bps: u32,
    pub n_reports: u32,
    pub finalised_at: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct OracleFeedContract;

#[contractimpl]
impl OracleFeedContract {
    pub fn version(_env: Env) -> u32 {
        2
    }

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, writer: Address) -> Result<(), ContractError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::WriterAddress, &writer);

        InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Write (ReportEngine only)
    // -----------------------------------------------------------------------

    /// Writes a finalised observation. Only the registered writer (ReportEngine) may call.
    pub fn write_observation(
        env: Env,
        caller: Address,
        observation: Observation,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_writer(&env, &caller)?;

        let latest_key =
            DataKey::Latest(observation.data_type.clone(), observation.geohash.clone());
        let history_key =
            DataKey::History(observation.data_type.clone(), observation.geohash.clone());

        // Update latest
        env.storage().persistent().set(&latest_key, &observation);

        // Update history (bounded, FIFO pruning)
        let mut history: Vec<Observation> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        history.push_back(observation.clone());

        // Prune if over limit
        while history.len() > MAX_HISTORY_LENGTH {
            history.remove(0);
        }

        env.storage().persistent().set(&history_key, &history);

        // Extend TTL — persistent observations should live long
        let ttl: u32 = 6_307_200; // ~1 year
        env.storage().persistent().extend_ttl(&latest_key, ttl, ttl);
        env.storage()
            .persistent()
            .extend_ttl(&history_key, ttl, ttl);

        ObservationWrittenEvent {
            request_id: observation.request_id,
            data_type: observation.data_type,
            value: observation.value,
            confidence_bps: observation.confidence_bps,
            n_reports: observation.n_reports,
            finalised_at: observation.finalised_at,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read (public, README 8.3 interface)
    // -----------------------------------------------------------------------

    /// Fetches the latest finalised observation for a data_type + geohash.
    pub fn get_latest(env: Env, data_type: Symbol, geohash: BytesN<8>) -> Option<Observation> {
        env.storage()
            .persistent()
            .get(&DataKey::Latest(data_type, geohash))
    }

    /// Fetches up to `limit` historical observations (most-recent first).
    /// Capped at DEFAULT_HISTORY_LIMIT if limit == 0; at MAX_HISTORY_LENGTH if limit > MAX_HISTORY_LENGTH.
    pub fn get_history(
        env: Env,
        data_type: Symbol,
        geohash: BytesN<8>,
        limit: u32,
    ) -> Vec<Observation> {
        let effective_limit = if limit == 0 {
            DEFAULT_HISTORY_LIMIT
        } else {
            limit.min(MAX_HISTORY_LENGTH)
        };

        let history_key = DataKey::History(data_type, geohash);
        let history: Vec<Observation> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        let total = history.len();
        if total == 0 {
            return Vec::new(&env);
        }

        // Return most recent `effective_limit` entries (tail of the vec)
        let mut result = Vec::new(&env);
        let start = total.saturating_sub(effective_limit);
        for i in start..total {
            result.push_back(history.get(i).unwrap());
        }

        // Reverse to get most-recent-first
        let result_len = result.len();
        let mut reversed = Vec::new(&env);
        for i in 0..result_len {
            reversed.push_back(result.get(result_len - 1 - i).unwrap());
        }
        reversed
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /// Update the authorised writer (e.g., after ReportEngine upgrade).
    pub fn set_writer(env: Env, admin: Address, writer: Address) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::WriterAddress, &writer);
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

    fn assert_writer(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let writer: Address = env
            .storage()
            .instance()
            .get(&DataKey::WriterAddress)
            .ok_or(ContractError::NotInitialized)?;
        if &writer != caller {
            Err(ContractError::NotAuthorizedWriter)
        } else {
            Ok(())
        }
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
