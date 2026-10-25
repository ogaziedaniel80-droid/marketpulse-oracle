#![no_std]

use marketpulse_shared::{
    bps_mul, ContractError, ReporterStatus, ReporterTier, ReputationInfo,
    BASE_REPUTATION_WEIGHT_BPS, DEFAULT_MIN_STAKE_NEW_REPORTER, DEFAULT_STAKE_CAP_TIER_1,
    DEFAULT_STAKE_CAP_TIER_2, DEFAULT_STAKE_CAP_TIER_3, DEFAULT_VOUCHER_LOCK_STAKE,
    DEFAULT_VOUCHER_SLASH_FRACTION_BPS, INITIAL_REPUTATION_SCORE, MAX_REPUTATION_DELTA_PER_REQ,
    MAX_REPUTATION_SCORE, REPUTATION_CONFIRMED_GAIN, REPUTATION_OUTLIER_PENALTY,
};
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryParams {
    pub min_stake_tier1: i128,
    pub stake_cap_tier1: i128,
    pub stake_cap_tier2: i128,
    pub stake_cap_tier3: i128,
    pub base_weight_bps: u32,
    pub confirmed_gain: u32,
    pub outlier_penalty: u32,
    pub max_delta_per_req: u32,
    pub voucher_lock_stake: i128,
    pub voucher_slash_fraction_bps: u32,
}

impl Default for RegistryParams {
    fn default() -> Self {
        Self {
            min_stake_tier1: DEFAULT_MIN_STAKE_NEW_REPORTER,
            stake_cap_tier1: DEFAULT_STAKE_CAP_TIER_1,
            stake_cap_tier2: DEFAULT_STAKE_CAP_TIER_2,
            stake_cap_tier3: DEFAULT_STAKE_CAP_TIER_3,
            base_weight_bps: BASE_REPUTATION_WEIGHT_BPS,
            confirmed_gain: REPUTATION_CONFIRMED_GAIN,
            outlier_penalty: REPUTATION_OUTLIER_PENALTY,
            max_delta_per_req: MAX_REPUTATION_DELTA_PER_REQ,
            voucher_lock_stake: DEFAULT_VOUCHER_LOCK_STAKE,
            voucher_slash_fraction_bps: DEFAULT_VOUCHER_SLASH_FRACTION_BPS,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReporterProfile {
    pub attestation_hash: BytesN<32>,
    pub status: ReporterStatus,
    pub tier: ReporterTier,
    pub score: u32,
    pub confirmed_count: u32,
    pub outlier_count: u32,
    pub fraud_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VouchRecord {
    pub voucher: Address,
    pub locked_stake: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Params,
    AuthorizedCaller(Address),
    Reporter(Address),
    Vouch(Address),
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
pub struct ReporterEnrolledEvent {
    pub reporter: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationUpdatedEvent {
    pub reporter: Address,
    pub score: u32,
    pub tier: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReporterFraudEvent {
    pub reporter: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReporterStatusUpdatedEvent {
    pub reporter: Address,
    pub status: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReporterVouchedEvent {
    pub voucher: Address,
    pub reporter: Address,
    pub lock_stake: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoucherSlashedEvent {
    pub reporter: Address,
    pub voucher: Address,
    pub slash_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminUpdatedEvent {
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParamsUpdatedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizedCallerUpdatedEvent {
    pub caller: Address,
    pub authorized: bool,
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn version(_env: Env) -> u32 {
        1
    }

    /// Initializes the Registry contract with admin address and default params.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
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
            .set(&DataKey::Params, &RegistryParams::default());

        InitializedEvent { admin }.publish(&env);

        Ok(())
    }

    /// Enrolls a new reporter. Requires reporter auth.
    pub fn enroll(
        env: Env,
        reporter: Address,
        attestation: BytesN<32>,
    ) -> Result<(), ContractError> {
        reporter.require_auth();

        let key = DataKey::Reporter(reporter.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::DuplicateCommitment);
        }

        let profile = ReporterProfile {
            attestation_hash: attestation,
            status: ReporterStatus::Active,
            tier: ReporterTier::Tier1,
            score: INITIAL_REPUTATION_SCORE,
            confirmed_count: 0,
            outlier_count: 0,
            fraud_count: 0,
        };

        env.storage().persistent().set(&key, &profile);

        ReporterEnrolledEvent { reporter }.publish(&env);

        Ok(())
    }

    /// View reputation info for a reporter.
    pub fn reputation(env: Env, reporter: Address) -> Result<ReputationInfo, ContractError> {
        let key = DataKey::Reporter(reporter.clone());
        let profile: ReporterProfile = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::ReporterNotEnrolled)?;

        let weight = Self::calc_weight(&env, &profile);
        let cap = Self::calc_stake_cap(&env, &profile);

        Ok(ReputationInfo {
            reporter,
            score: profile.score,
            tier: profile.tier,
            status: profile.status,
            confirmed_count: profile.confirmed_count,
            outlier_count: profile.outlier_count,
            fraud_count: profile.fraud_count,
            weight_bps: weight,
            stake_cap: cap,
            attestation_hash: profile.attestation_hash,
        })
    }

    /// View current weight in basis points for commit snapshot.
    pub fn weight_bps(env: Env, reporter: Address) -> u32 {
        let key = DataKey::Reporter(reporter);
        match env
            .storage()
            .persistent()
            .get::<DataKey, ReporterProfile>(&key)
        {
            Some(profile) => Self::calc_weight(&env, &profile),
            None => 0,
        }
    }

    /// View maximum stake cap for a reporter.
    pub fn stake_cap(env: Env, reporter: Address) -> i128 {
        let key = DataKey::Reporter(reporter);
        match env
            .storage()
            .persistent()
            .get::<DataKey, ReporterProfile>(&key)
        {
            Some(profile) => Self::calc_stake_cap(&env, &profile),
            None => 0,
        }
    }

    /// Update reputation score for a reporter (slow up / fast down).
    /// Bounded delta per request. Only authorized callers.
    pub fn update_reputation(
        env: Env,
        caller: Address,
        reporter: Address,
        delta: u32,
        is_positive: bool,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let params: RegistryParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        if delta > params.max_delta_per_req {
            return Err(ContractError::MaxReputationDeltaExceeded);
        }

        let key = DataKey::Reporter(reporter.clone());
        let mut profile: ReporterProfile = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::ReporterNotEnrolled)?;

        if profile.status == ReporterStatus::Banned {
            return Err(ContractError::ReporterBanned);
        }

        if is_positive {
            profile.score = (profile.score + delta).min(MAX_REPUTATION_SCORE);
            profile.confirmed_count = profile.confirmed_count.saturating_add(1);

            // Tier promotion logic based on sustained reputation and confirmations
            if profile.tier == ReporterTier::Tier1
                && profile.score >= 50
                && profile.confirmed_count >= 20
            {
                profile.tier = ReporterTier::Tier2;
            } else if profile.tier == ReporterTier::Tier2
                && profile.score >= 200
                && profile.confirmed_count >= 100
            {
                profile.tier = ReporterTier::Tier3;
            }
        } else {
            profile.score = profile.score.saturating_sub(delta);
            profile.outlier_count = profile.outlier_count.saturating_add(1);

            // Tier demotion logic
            if profile.tier == ReporterTier::Tier3 && profile.score < 150 {
                profile.tier = ReporterTier::Tier2;
            } else if profile.tier == ReporterTier::Tier2 && profile.score < 30 {
                profile.tier = ReporterTier::Tier1;
            }
        }

        env.storage().persistent().set(&key, &profile);

        ReputationUpdatedEvent {
            reporter,
            score: profile.score,
            tier: profile.tier as u32,
        }
        .publish(&env);

        Ok(())
    }

    /// Resets reputation and bans reporter for proven fraud.
    pub fn reset_reputation_fraud(
        env: Env,
        caller: Address,
        reporter: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let key = DataKey::Reporter(reporter.clone());
        let mut profile: ReporterProfile = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::ReporterNotEnrolled)?;

        profile.score = 0;
        profile.fraud_count = profile.fraud_count.saturating_add(1);
        profile.status = ReporterStatus::Banned;

        env.storage().persistent().set(&key, &profile);

        ReporterFraudEvent { reporter }.publish(&env);

        Ok(())
    }

    /// Sets reporter status (Active, Suspended, Banned).
    pub fn set_status(
        env: Env,
        caller: Address,
        reporter: Address,
        status: ReporterStatus,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let key = DataKey::Reporter(reporter.clone());
        let mut profile: ReporterProfile = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::ReporterNotEnrolled)?;

        profile.status = status;
        env.storage().persistent().set(&key, &profile);

        ReporterStatusUpdatedEvent {
            reporter,
            status: status as u32,
        }
        .publish(&env);

        Ok(())
    }

    /// Vouches for a reporter, locking voucher stake.
    pub fn vouch(
        env: Env,
        voucher: Address,
        reporter: Address,
        lock_stake: i128,
    ) -> Result<(), ContractError> {
        voucher.require_auth();

        if voucher == reporter {
            return Err(ContractError::InvalidParameter);
        }

        let reporter_key = DataKey::Reporter(reporter.clone());
        if !env.storage().persistent().has(&reporter_key) {
            return Err(ContractError::ReporterNotEnrolled);
        }

        let vouch_key = DataKey::Vouch(reporter.clone());
        if env.storage().persistent().has(&vouch_key) {
            return Err(ContractError::VoucherAlreadyExists);
        }

        let params: RegistryParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        if lock_stake < params.voucher_lock_stake {
            return Err(ContractError::InsufficientVoucherStake);
        }

        let record = VouchRecord {
            voucher: voucher.clone(),
            locked_stake: lock_stake,
        };

        env.storage().persistent().set(&vouch_key, &record);

        ReporterVouchedEvent {
            voucher,
            reporter,
            lock_stake,
        }
        .publish(&env);

        Ok(())
    }

    /// View vouch record for a reporter.
    pub fn get_voucher(env: Env, reporter: Address) -> Option<VouchRecord> {
        let key = DataKey::Vouch(reporter);
        env.storage().persistent().get(&key)
    }

    /// Slashes voucher liability upon proven fraud.
    pub fn slash_voucher(
        env: Env,
        caller: Address,
        reporter: Address,
        fraud_slash_fraction_bps: u32,
    ) -> Result<i128, ContractError> {
        caller.require_auth();
        Self::assert_authorized(&env, &caller)?;

        let key = DataKey::Vouch(reporter.clone());
        let mut record: VouchRecord = match env.storage().persistent().get(&key) {
            Some(rec) => rec,
            None => return Ok(0),
        };

        let slash_amount = bps_mul(record.locked_stake, fraud_slash_fraction_bps)?;
        record.locked_stake = record.locked_stake.saturating_sub(slash_amount);

        let voucher = record.voucher.clone();

        if record.locked_stake == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &record);
        }

        VoucherSlashedEvent {
            reporter,
            voucher,
            slash_amount,
        }
        .publish(&env);

        Ok(slash_amount)
    }

    // -------------------------------------------------------------------------
    // Admin functions
    // -------------------------------------------------------------------------

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
            .set(&DataKey::AuthorizedCaller(new_admin.clone()), &true);

        AdminUpdatedEvent { new_admin }.publish(&env);

        Ok(())
    }

    pub fn set_params(
        env: Env,
        admin: Address,
        params: RegistryParams,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::assert_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Params, &params);

        ParamsUpdatedEvent { admin }.publish(&env);

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
            .set(&DataKey::AuthorizedCaller(caller.clone()), &authorized);

        AuthorizedCallerUpdatedEvent { caller, authorized }.publish(&env);

        Ok(())
    }

    // -------------------------------------------------------------------------
    // Internal helper calculations
    // -------------------------------------------------------------------------

    fn calc_weight(env: &Env, profile: &ReporterProfile) -> u32 {
        if profile.status != ReporterStatus::Active {
            return 0;
        }

        let params: RegistryParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        match profile.tier {
            ReporterTier::Tier1 => {
                // Tier 1: 1,000 bps (10%) baseline + up to 1,500 bps from score -> max 2,500 bps
                (params.base_weight_bps + profile.score * 15).min(2_500)
            }
            ReporterTier::Tier2 => {
                // Tier 2: 2,500 bps (25%) baseline + up to 2,500 bps from score -> max 5,000 bps
                (2_500 + profile.score * 20).min(5_000)
            }
            ReporterTier::Tier3 => {
                // Tier 3: 5,000 bps (50%) baseline + up to 5,000 bps from score -> max 10,000 bps (100%)
                (5_000 + profile.score * 30).min(10_000)
            }
        }
    }

    fn calc_stake_cap(env: &Env, profile: &ReporterProfile) -> i128 {
        if profile.status != ReporterStatus::Active {
            return 0;
        }

        let params: RegistryParams = env
            .storage()
            .instance()
            .get(&DataKey::Params)
            .unwrap_or_default();

        match profile.tier {
            ReporterTier::Tier1 => params.stake_cap_tier1,
            ReporterTier::Tier2 => params.stake_cap_tier2,
            ReporterTier::Tier3 => params.stake_cap_tier3,
        }
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
