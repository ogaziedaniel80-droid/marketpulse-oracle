#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

#[test]
fn test_registry_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    let voucher = Address::generate(&env);
    let engine = Address::generate(&env);

    // Initialize
    client.initialize(&admin);

    // Authorize ReportEngine
    client.set_authorized_caller(&admin, &engine, &true);

    // Enroll reporter
    let attestation = BytesN::from_array(&env, &[7u8; 32]);
    client.enroll(&reporter, &attestation);

    // Verify initial profile
    let rep_info = client.reputation(&reporter);
    assert_eq!(rep_info.score, INITIAL_REPUTATION_SCORE);
    assert_eq!(rep_info.tier, ReporterTier::Tier1);
    assert_eq!(rep_info.status, ReporterStatus::Active);
    assert_eq!(rep_info.confirmed_count, 0);
    assert_eq!(rep_info.stake_cap, DEFAULT_STAKE_CAP_TIER_1);
    assert_eq!(
        rep_info.weight_bps,
        BASE_REPUTATION_WEIGHT_BPS + INITIAL_REPUTATION_SCORE * 15
    );

    // Vouching
    client.vouch(&voucher, &reporter, &DEFAULT_VOUCHER_LOCK_STAKE);
    let vouch_rec = client.get_voucher(&reporter).unwrap();
    assert_eq!(vouch_rec.voucher, voucher);
    assert_eq!(vouch_rec.locked_stake, DEFAULT_VOUCHER_LOCK_STAKE);

    // Reputation slow up (+1)
    client.update_reputation(&engine, &reporter, &1, &true);
    let rep_after_up = client.reputation(&reporter);
    assert_eq!(rep_after_up.score, INITIAL_REPUTATION_SCORE + 1);
    assert_eq!(rep_after_up.confirmed_count, 1);

    // Reputation fast down (-5)
    client.update_reputation(&engine, &reporter, &5, &false);
    let rep_after_down = client.reputation(&reporter);
    assert_eq!(rep_after_down.score, INITIAL_REPUTATION_SCORE + 1 - 5);
    assert_eq!(rep_after_down.outlier_count, 1);

    // Fraud reset and voucher liability slashing
    client.reset_reputation_fraud(&engine, &reporter);
    let rep_fraud = client.reputation(&reporter);
    assert_eq!(rep_fraud.score, 0);
    assert_eq!(rep_fraud.status, ReporterStatus::Banned);
    assert_eq!(rep_fraud.fraud_count, 1);

    // Voucher slashed (50% = 5000 bps)
    let slashed = client.slash_voucher(&engine, &reporter, &5_000);
    assert_eq!(slashed, DEFAULT_VOUCHER_LOCK_STAKE / 2);
    let vouch_after_slash = client.get_voucher(&reporter).unwrap();
    assert_eq!(
        vouch_after_slash.locked_stake,
        DEFAULT_VOUCHER_LOCK_STAKE / 2
    );
}

#[test]
fn test_tier_promotions_and_weight_stake_caps() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.initialize(&admin);
    let attestation = BytesN::from_array(&env, &[10u8; 32]);
    client.enroll(&reporter, &attestation);

    // Tier 1 bounds
    assert_eq!(client.stake_cap(&reporter), DEFAULT_STAKE_CAP_TIER_1);

    // Advance confirmations and score to trigger promotion to Tier 2 (score >= 50, confirmed >= 20)
    for _ in 0..20 {
        client.update_reputation(&admin, &reporter, &2, &true);
    }
    let rep_tier2 = client.reputation(&reporter);
    assert_eq!(rep_tier2.tier, ReporterTier::Tier2);
    assert_eq!(client.stake_cap(&reporter), DEFAULT_STAKE_CAP_TIER_2);
    assert!(client.weight_bps(&reporter) >= 2_500);

    // Advance to Tier 3 (score >= 200, confirmed >= 100)
    for _ in 0..80 {
        client.update_reputation(&admin, &reporter, &2, &true);
    }
    let rep_tier3 = client.reputation(&reporter);
    assert_eq!(rep_tier3.tier, ReporterTier::Tier3);
    assert_eq!(client.stake_cap(&reporter), DEFAULT_STAKE_CAP_TIER_3);
    assert!(client.weight_bps(&reporter) >= 5_000);
}

#[test]
fn test_unauthorized_callers_rejected_for_every_admin_and_status_function() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let unauth = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.initialize(&admin);
    let attestation = BytesN::from_array(&env, &[11u8; 32]);
    client.enroll(&reporter, &attestation);

    // 1. set_admin by unauthorized
    let res = client.try_set_admin(&unauth, &unauth);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // 2. set_params by unauthorized
    let res = client.try_set_params(&unauth, &RegistryParams::default());
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // 3. set_authorized_caller by unauthorized
    let res = client.try_set_authorized_caller(&unauth, &unauth, &true);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // 4. set_status by unauthorized
    let res = client.try_set_status(&unauth, &reporter, &ReporterStatus::Suspended);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // 5. reset_reputation_fraud by unauthorized
    let res = client.try_reset_reputation_fraud(&unauth, &reporter);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // 6. slash_voucher by unauthorized
    let res = client.try_slash_voucher(&unauth, &reporter, &5000);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);
}

#[test]
fn test_enrollment_duplicate_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.initialize(&admin);
    let attestation = BytesN::from_array(&env, &[1u8; 32]);
    client.enroll(&reporter, &attestation);

    let res = client.try_enroll(&reporter, &attestation);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::DuplicateCommitment
    );
}

#[test]
fn test_reputation_delta_bounded_per_request() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.initialize(&admin);
    let attestation = BytesN::from_array(&env, &[3u8; 32]);
    client.enroll(&reporter, &attestation);

    // Delta 15 exceeds MAX_REPUTATION_DELTA_PER_REQ (10)
    let res = client.try_update_reputation(&admin, &reporter, &15, &true);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::MaxReputationDeltaExceeded
    );
}

#[test]
fn test_vouch_self_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.initialize(&admin);
    let attestation = BytesN::from_array(&env, &[4u8; 32]);
    client.enroll(&reporter, &attestation);

    let res = client.try_vouch(&reporter, &reporter, &DEFAULT_VOUCHER_LOCK_STAKE);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::InvalidParameter);
}
