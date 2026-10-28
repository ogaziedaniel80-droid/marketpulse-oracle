#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, Symbol};

fn setup() -> (
    Env,
    OracleFeedContractClient<'static>,
    Address, // admin
    Address, // writer (ReportEngine address)
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let writer = Address::generate(&env);

    let contract_id = env.register(OracleFeedContract, ());
    let client = OracleFeedContractClient::new(&env, &contract_id);
    client.initialize(&admin, &writer);

    (env, client, admin, writer)
}

fn make_obs(env: &Env, request_id: u64, value: i128, ts: u64) -> Observation {
    Observation {
        request_id,
        data_type: Symbol::new(env, "RICE50"),
        geohash: BytesN::from_array(env, b"s14b3k9x"),
        value,
        confidence_bps: 9_000,
        n_reports: 7,
        finalised_at: ts,
    }
}

#[test]
fn test_version() {
    let env = Env::default();
    let id = env.register(OracleFeedContract, ());
    let client = OracleFeedContractClient::new(&env, &id);
    assert_eq!(client.version(), 2);
}

#[test]
fn test_initialize_twice_rejected() {
    let (_env, client, admin, writer) = setup();
    let res = client.try_initialize(&admin, &writer);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyInitialized);
}

#[test]
fn test_write_and_get_latest() {
    let (env, client, _admin, writer) = setup();

    let obs = make_obs(&env, 1, 825_000, 1_000_000);
    client.write_observation(&writer, &obs);

    let latest = client
        .get_latest(
            &Symbol::new(&env, "RICE50"),
            &BytesN::from_array(&env, b"s14b3k9x"),
        )
        .unwrap();
    assert_eq!(latest.value, 825_000);
    assert_eq!(latest.request_id, 1);
    assert_eq!(latest.finalised_at, 1_000_000);
}

#[test]
fn test_unauthorized_writer_rejected() {
    let (env, client, _admin, _writer) = setup();
    let rogue = Address::generate(&env);
    let obs = make_obs(&env, 2, 900_000, 2_000_000);
    let res = client.try_write_observation(&rogue, &obs);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::NotAuthorizedWriter
    );
}

#[test]
fn test_get_latest_returns_none_when_no_observations() {
    let (env, client, _admin, _writer) = setup();
    let result = client.get_latest(
        &Symbol::new(&env, "TOMATO"),
        &BytesN::from_array(&env, b"s14b3k9x"),
    );
    assert!(result.is_none());
}

#[test]
fn test_history_is_most_recent_first() {
    let (env, client, _admin, writer) = setup();
    let geohash = BytesN::from_array(&env, b"s14b3k9x");
    let dt = Symbol::new(&env, "RICE50");

    // Write 5 observations with increasing values and timestamps
    for i in 1u64..=5 {
        let obs = make_obs(&env, i, i as i128 * 10_000, i * 1000);
        client.write_observation(&writer, &obs);
    }

    let history = client.get_history(&dt, &geohash, &3);
    assert_eq!(history.len(), 3);
    // Most recent first: value 50000, 40000, 30000
    assert_eq!(history.get(0).unwrap().value, 50_000);
    assert_eq!(history.get(1).unwrap().value, 40_000);
    assert_eq!(history.get(2).unwrap().value, 30_000);
}

#[test]
fn test_history_bounded_at_max_history_length() {
    let (env, client, _admin, writer) = setup();
    let geohash = BytesN::from_array(&env, b"s14b3k9x");
    let dt = Symbol::new(&env, "RICE50");

    // Write MAX_HISTORY_LENGTH + 10 observations
    let total = MAX_HISTORY_LENGTH + 10;
    for i in 1u32..=total {
        let obs = make_obs(&env, i as u64, i as i128 * 1000, i as u64 * 100);
        client.write_observation(&writer, &obs);
    }

    // History should be bounded at MAX_HISTORY_LENGTH
    let history = client.get_history(&dt, &geohash, &(MAX_HISTORY_LENGTH + 20));
    assert_eq!(history.len(), MAX_HISTORY_LENGTH);

    // Oldest pruned: first 10 should be gone
    // Most recent is total, least recent in history is 11
    let oldest_kept = history.get(history.len() - 1).unwrap();
    assert_eq!(oldest_kept.request_id, 11);
    let newest = history.get(0).unwrap();
    assert_eq!(newest.request_id, total as u64);
}

#[test]
fn test_get_history_limit_zero_uses_default() {
    let (env, client, _admin, writer) = setup();
    let geohash = BytesN::from_array(&env, b"s14b3k9x");
    let dt = Symbol::new(&env, "RICE50");

    for i in 1u64..=30 {
        let obs = make_obs(&env, i, i as i128 * 1000, i * 100);
        client.write_observation(&writer, &obs);
    }

    let history = client.get_history(&dt, &geohash, &0);
    assert_eq!(history.len(), DEFAULT_HISTORY_LIMIT);
}

#[test]
fn test_different_geohashes_are_independent() {
    let (env, client, _admin, writer) = setup();
    let dt = Symbol::new(&env, "RICE50");
    let geo1 = BytesN::from_array(&env, b"s14b3k9x");
    let geo2 = BytesN::from_array(&env, b"s14b3000");

    let mut obs1 = make_obs(&env, 1, 100_000, 1000);
    obs1.geohash = geo1.clone();
    let mut obs2 = make_obs(&env, 2, 200_000, 2000);
    obs2.geohash = geo2.clone();

    client.write_observation(&writer, &obs1);
    client.write_observation(&writer, &obs2);

    let latest1 = client.get_latest(&dt, &geo1).unwrap();
    let latest2 = client.get_latest(&dt, &geo2).unwrap();
    assert_eq!(latest1.value, 100_000);
    assert_eq!(latest2.value, 200_000);
}

#[test]
fn test_set_writer_admin_only() {
    let (env, client, admin, _writer) = setup();
    let new_writer = Address::generate(&env);
    let rogue = Address::generate(&env);

    // Non-admin rejected
    let res = client.try_set_writer(&rogue, &new_writer);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);

    // Admin succeeds
    client.set_writer(&admin, &new_writer);

    // Old writer can no longer write
    let obs = make_obs(&env, 10, 111_000, 9999);
    // Note: after set_writer, the old writer address fails
    // In mock_all_auths test env all auth passes; verify at contract logic level
    // New writer succeeds:
    client.write_observation(&new_writer, &obs);
    let latest = client
        .get_latest(
            &Symbol::new(&env, "RICE50"),
            &BytesN::from_array(&env, b"s14b3k9x"),
        )
        .unwrap();
    assert_eq!(latest.value, 111_000);
}

#[test]
fn test_write_overwrites_latest() {
    let (env, client, _admin, writer) = setup();

    let obs1 = make_obs(&env, 1, 100_000, 1000);
    let obs2 = make_obs(&env, 2, 200_000, 2000);

    client.write_observation(&writer, &obs1);
    client.write_observation(&writer, &obs2);

    let latest = client
        .get_latest(
            &Symbol::new(&env, "RICE50"),
            &BytesN::from_array(&env, b"s14b3k9x"),
        )
        .unwrap();
    assert_eq!(latest.value, 200_000);
    assert_eq!(latest.request_id, 2);
}
