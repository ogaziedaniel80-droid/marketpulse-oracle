#![cfg(test)]

extern crate std;

use super::*;
use marketpulse_shared::{
    ContractError, DEFAULT_MAX_REPORTS_CAP, DEFAULT_MIN_STAKE_NEW_REPORTER,
    DEFAULT_NON_REVEAL_SLASH_BPS, DEFAULT_OUTLIER_SLASH_BPS, DEFAULT_PROTOCOL_FEE_BPS,
    REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS,
};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, BytesN, Env, Symbol};

// Cross-contract dependencies
use marketpulse_oracle_feed::OracleFeedContract;
use marketpulse_oracle_feed::OracleFeedContractClient;
use marketpulse_registry::{RegistryContract, RegistryContractClient};
use marketpulse_request_board::{RequestBoardContract, RequestBoardContractClient};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct TestHarness {
    env: Env,
    engine: ReportEngineContractClient<'static>,
    registry: RegistryContractClient<'static>,
    board: RequestBoardContractClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    token_addr: Address,
    admin: Address,
    treasury: Address,
    audit_fund: Address,
}

impl TestHarness {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let audit_fund = Address::generate(&env);

        // Token
        let token_admin_addr = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
        let token_addr = token_contract.address();
        let token = token::Client::new(&env, &token_addr);
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);

        // Registry
        let reg_id = env.register(RegistryContract, ());
        let registry = RegistryContractClient::new(&env, &reg_id);
        registry.initialize(&admin);

        // RequestBoard
        let board_id = env.register(RequestBoardContract, ());
        let board = RequestBoardContractClient::new(&env, &board_id);
        board.initialize(&admin);

        // OracleFeed (writer set to engine address after engine is deployed)
        let feed_id = env.register(OracleFeedContract, ());

        // ReportEngine
        let engine_id = env.register(ReportEngineContract, ());
        let engine = ReportEngineContractClient::new(&env, &engine_id);
        engine.initialize(&admin, &reg_id, &board_id, &feed_id, &treasury, &audit_fund);

        // Authorize engine in Registry and Board
        registry.set_authorized_caller(&admin, &engine_id, &true);
        board.set_authorized_caller(&admin, &engine_id, &true);

        // Initialize OracleFeed with engine as writer
        let feed = OracleFeedContractClient::new(&env, &feed_id);
        feed.initialize(&admin, &engine_id);

        TestHarness {
            env,
            engine,
            registry,
            board,
            token,
            token_admin,
            token_addr,
            admin,
            treasury,
            audit_fund,
        }
    }

    fn enroll_reporter(&self, reporter: &Address) {
        let attestation = BytesN::from_array(&self.env, &[0u8; 32]);
        self.registry.enroll(reporter, &attestation);
    }

    fn mint_and_fund(&self, addr: &Address, amount: i128) {
        self.token_admin.mint(addr, &amount);
    }

    fn make_request(&self, requester: &Address, bounty: i128) -> u64 {
        let now = self.env.ledger().timestamp();
        let params = marketpulse_shared::RequestParams {
            data_type: Symbol::new(&self.env, "RICE50"),
            geohash: BytesN::from_array(&self.env, b"s14b3k9x"),
            bounty,
            token: self.token_addr.clone(),
            min_stake: DEFAULT_MIN_STAKE_NEW_REPORTER,
            tolerance_bps: 800,
            commit_deadline: now + 3_600,
            reveal_deadline: now + 7_200,
            challenge_window: 86_400,
            min_reports: 3,
            max_reports: 15,
        };
        self.board.create_request(requester, &params)
    }

    /// Compute sha256(value_le_bytes || salt_bytes) matching the contract's commitment scheme.
    fn make_commitment(&self, value: i128, salt: &[u8; 32]) -> BytesN<32> {
        let salt_bytes = BytesN::from_array(&self.env, salt);
        let mut preimage = soroban_sdk::Bytes::new(&self.env);
        for b in value.to_le_bytes() {
            preimage.push_back(b);
        }
        for i in 0..32u32 {
            preimage.push_back(salt_bytes.get(i).unwrap());
        }
        self.env.crypto().sha256(&preimage).into()
    }

    fn advance_to_reveal(&self, request_id: u64) {
        let req = self.board.get_request(&request_id);
        self.env.ledger().set_timestamp(req.commit_deadline + 1);
    }

    fn advance_past_reveal(&self, request_id: u64) {
        let req = self.board.get_request(&request_id);
        self.env.ledger().set_timestamp(req.reveal_deadline + 1);
    }

    fn advance_past_challenge(&self, request_id: u64) {
        let res = self
            .engine
            .get_resolution(&request_id)
            .expect("no resolution");
        self.env
            .ledger()
            .set_timestamp(res.challenge_window_end + 1);
    }
}

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

#[test]
fn test_full_lifecycle_commit_reveal_resolve_claim_finalise() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    let reporters: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(env)).collect();
    let salts: [[u8; 32]; 5] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 1;
        s
    });
    let values: [i128; 5] = [825_000, 830_000, 820_000, 825_000, 828_000];

    for i in 0..5 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let commitment = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &commitment,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }

    h.advance_to_reveal(request_id);

    for i in 0..5 {
        let salt = BytesN::from_array(env, &salts[i]);
        let evidence = BytesN::from_array(env, &[0xABu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &evidence);
    }

    h.advance_past_reveal(request_id);

    let resolution = h.engine.resolve(&request_id);
    assert_eq!(resolution.n_accepted, 5);
    assert!(resolution.confidence_bps > 0);
    assert!(resolution.median_value >= 820_000 && resolution.median_value <= 830_000);

    let req = h.board.get_request(&request_id);
    assert_eq!(req.status, marketpulse_shared::RequestStatus::Challengeable);

    for reporter in &reporters {
        let claimed = h.engine.claim(reporter, &request_id);
        assert!(claimed > 0);
    }

    h.advance_past_challenge(request_id);
    h.engine.finalise(&request_id);

    let req_final = h.board.get_request(&request_id);
    assert_eq!(
        req_final.status,
        marketpulse_shared::RequestStatus::Finalised
    );
}

// ---------------------------------------------------------------------------
// Resolve is idempotent
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_twice_is_noop() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    let reporters: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(env)).collect();
    let values = [800_000i128; 3];
    let salts: [[u8; 32]; 3] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8;
        s
    });

    for i in 0..3 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &c,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }
    h.advance_to_reveal(request_id);
    for i in 0..3 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0xCCu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);

    let res1 = h.engine.resolve(&request_id);
    let res2 = h.engine.resolve(&request_id);
    assert_eq!(res1.median_value, res2.median_value);
    assert_eq!(res1.n_accepted, res2.n_accepted);
}

// ---------------------------------------------------------------------------
// Under-subscription refunds bounty
// ---------------------------------------------------------------------------

#[test]
fn test_undersubscription_refunds_bounty() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let bounty = 50_000_000i128;
    let request_id = h.make_request(&requester, bounty);

    // Only 2 reveal (min_reports = 3)
    let reporters: std::vec::Vec<Address> = (0..2).map(|_| Address::generate(env)).collect();
    let values = [800_000i128; 2];
    let salts: [[u8; 32]; 2] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 10;
        s
    });

    for i in 0..2 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &c,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }
    h.advance_to_reveal(request_id);
    for i in 0..2 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0xBBu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);

    let bal_before = h.token.balance(&requester);
    h.engine.resolve(&request_id);
    let bal_after = h.token.balance(&requester);

    assert_eq!(bal_after - bal_before, bounty, "bounty must be refunded");
    let req = h.board.get_request(&request_id);
    assert_eq!(req.status, marketpulse_shared::RequestStatus::Cancelled);
}

// ---------------------------------------------------------------------------
// Reveal with wrong salt → CommitmentMismatch
// ---------------------------------------------------------------------------

#[test]
fn test_reveal_wrong_salt_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    let value = 800_000i128;
    let real_salt = [1u8; 32];
    let wrong_salt = [2u8; 32];
    let commitment = h.make_commitment(value, &real_salt);
    h.engine.commit(
        &reporter,
        &request_id,
        &commitment,
        &DEFAULT_MIN_STAKE_NEW_REPORTER,
    );

    h.advance_to_reveal(request_id);
    let res = h.engine.try_reveal(
        &reporter,
        &request_id,
        &value,
        &BytesN::from_array(env, &wrong_salt),
        &BytesN::from_array(env, &[0u8; 32]),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::CommitmentMismatch);
}

// ---------------------------------------------------------------------------
// Early reveal → DeadlineNotMet
// ---------------------------------------------------------------------------

#[test]
fn test_early_reveal_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    let value = 800_000i128;
    let salt = [3u8; 32];
    let c = h.make_commitment(value, &salt);
    h.engine
        .commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);

    // Do NOT advance — still before commit_deadline
    let res = h.engine.try_reveal(
        &reporter,
        &request_id,
        &value,
        &BytesN::from_array(env, &salt),
        &BytesN::from_array(env, &[0u8; 32]),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::DeadlineNotMet);
}

// ---------------------------------------------------------------------------
// Late reveal → DeadlinePassed
// ---------------------------------------------------------------------------

#[test]
fn test_late_reveal_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    let value = 800_000i128;
    let salt = [4u8; 32];
    let c = h.make_commitment(value, &salt);
    h.engine
        .commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);

    h.advance_past_reveal(request_id); // Past reveal_deadline

    let res = h.engine.try_reveal(
        &reporter,
        &request_id,
        &value,
        &BytesN::from_array(env, &salt),
        &BytesN::from_array(env, &[0u8; 32]),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::DeadlinePassed);
}

// ---------------------------------------------------------------------------
// Double commit → DuplicateCommitment
// ---------------------------------------------------------------------------

#[test]
fn test_double_commit_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 20_000_000);

    let c = h.make_commitment(800_000, &[5u8; 32]);
    h.engine
        .commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);

    let res = h
        .engine
        .try_commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::DuplicateCommitment
    );
}

// ---------------------------------------------------------------------------
// Commit after deadline → DeadlinePassed
// ---------------------------------------------------------------------------

#[test]
fn test_commit_after_deadline_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    h.advance_to_reveal(request_id);
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);

    let c = h.make_commitment(800_000, &[6u8; 32]);
    let res = h
        .engine
        .try_commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::DeadlinePassed);
}

// ---------------------------------------------------------------------------
// Claim twice → AlreadyClaimed
// ---------------------------------------------------------------------------

#[test]
fn test_claim_twice_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    let reporters: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(env)).collect();
    let values = [800_000i128; 3];
    let salts: [[u8; 32]; 3] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 20;
        s
    });

    for i in 0..3 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &c,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }
    h.advance_to_reveal(request_id);
    for i in 0..3 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0xFFu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);
    h.engine.resolve(&request_id);

    h.engine.claim(&reporters[0], &request_id);
    let res = h.engine.try_claim(&reporters[0], &request_id);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyClaimed);
}

// ---------------------------------------------------------------------------
// Outlier receives gentle slash (25%)
// ---------------------------------------------------------------------------

#[test]
fn test_outlier_receives_gentle_slash() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    // 4 honest + 1 extreme outlier
    let reporters: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(env)).collect();
    let values: [i128; 5] = [800_000, 800_000, 800_000, 800_000, 2_000_000];
    let salts: [[u8; 32]; 5] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 30;
        s
    });
    let stake = DEFAULT_MIN_STAKE_NEW_REPORTER;

    for i in 0..5 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(&reporters[i], &request_id, &c, &stake);
    }
    h.advance_to_reveal(request_id);
    for i in 0..5 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0xDDu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);

    let resolution = h.engine.resolve(&request_id);
    assert_eq!(resolution.n_accepted, 4);
    assert!(resolution.total_slashed > 0);

    let outlier_payout = h.engine.get_payout(&reporters[4], &request_id).unwrap();
    let expected = stake - marketpulse_shared::bps_mul(stake, DEFAULT_OUTLIER_SLASH_BPS).unwrap();
    assert_eq!(outlier_payout.claimable, expected);
}

// ---------------------------------------------------------------------------
// Non-revealer gets heavy slash (50%)
// ---------------------------------------------------------------------------

#[test]
fn test_non_revealer_gets_heavy_slash() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    let reporters: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(env)).collect();
    let values = [800_000i128; 4];
    let salts: [[u8; 32]; 4] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 40;
        s
    });
    let stake = DEFAULT_MIN_STAKE_NEW_REPORTER;

    for i in 0..4 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(&reporters[i], &request_id, &c, &stake);
    }
    h.advance_to_reveal(request_id);
    // Only first 3 reveal; reporters[3] does not
    for i in 0..3 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0xEEu8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);
    h.engine.resolve(&request_id);

    let non_rev_payout = h.engine.get_payout(&reporters[3], &request_id).unwrap();
    let expected =
        stake - marketpulse_shared::bps_mul(stake, DEFAULT_NON_REVEAL_SLASH_BPS).unwrap();
    assert_eq!(non_rev_payout.claimable, expected);
}

// ---------------------------------------------------------------------------
// Exact accounting: total_in == total_out (bounty + stakes = claimed + fees + dust)
// ---------------------------------------------------------------------------

#[test]
fn test_exact_accounting_5_reporters_all_accepted() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let bounty = 50_000_000i128;
    let request_id = h.make_request(&requester, bounty);

    let n: usize = 5;
    let stake = DEFAULT_MIN_STAKE_NEW_REPORTER;
    let reporters: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(env)).collect();
    let values = [800_000i128; 5];
    let salts: [[u8; 32]; 5] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 50;
        s
    });
    let total_stakes = stake * n as i128;
    let total_in = bounty + total_stakes;

    let treasury_before = h.token.balance(&h.treasury);
    let audit_before = h.token.balance(&h.audit_fund);

    for i in 0..n {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(values[i], &salts[i]);
        h.engine.commit(&reporters[i], &request_id, &c, &stake);
    }
    h.advance_to_reveal(request_id);
    for i in 0..n {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0x11u8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &values[i], &salt, &ev);
    }
    h.advance_past_reveal(request_id);
    h.engine.resolve(&request_id);

    let mut total_claimed = 0i128;
    for reporter in &reporters {
        total_claimed += h.engine.claim(reporter, &request_id);
    }

    let treasury_after = h.token.balance(&h.treasury);
    let audit_after = h.token.balance(&h.audit_fund);
    let total_out =
        total_claimed + (treasury_after - treasury_before) + (audit_after - audit_before);

    // Invariant: total_in - total_out <= dust (at most n minor units of rounding)
    let diff = total_in - total_out;
    assert!(
        diff >= 0 && diff <= n as i128,
        "accounting mismatch: total_in={} total_out={} diff={}",
        total_in,
        total_out,
        diff
    );
}

// ---------------------------------------------------------------------------
// Property-based: accounting invariant under random scenarios
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10))]

    #[test]
    fn prop_exact_accounting(
        bounty in 30_000_000i128..=200_000_000i128,
        n_reporters in 3usize..=8usize,
    ) {
        let h = TestHarness::setup();
        let env = &h.env;

        let requester = Address::generate(env);
        h.mint_and_fund(&requester, bounty + 10_000_000);
        let request_id = h.make_request(&requester, bounty);

        let stake = DEFAULT_MIN_STAKE_NEW_REPORTER;
        let reporters: std::vec::Vec<Address> =
            (0..n_reporters).map(|_| Address::generate(env)).collect();
        let salts: std::vec::Vec<[u8; 32]> = (0..n_reporters)
            .map(|i| { let mut s = [0u8; 32]; s[0] = i as u8; s })
            .collect();

        let total_stakes = stake * n_reporters as i128;
        let total_in = bounty + total_stakes;

        let treasury_before = h.token.balance(&h.treasury);
        let audit_before = h.token.balance(&h.audit_fund);

        for i in 0..n_reporters {
            h.enroll_reporter(&reporters[i]);
            h.mint_and_fund(&reporters[i], 10_000_000);
            let c = h.make_commitment(800_000, &salts[i]);
            h.engine.commit(&reporters[i], &request_id, &c, &stake);
        }
        h.advance_to_reveal(request_id);
        for i in 0..n_reporters {
            let salt = BytesN::from_array(env, &salts[i]);
            let ev = BytesN::from_array(env, &[0xAAu8; 32]);
            h.engine.reveal(&reporters[i], &request_id, &800_000i128, &salt, &ev);
        }
        h.advance_past_reveal(request_id);
        h.engine.resolve(&request_id);

        let mut total_claimed = 0i128;
        for reporter in &reporters {
            if let Some(payout) = h.engine.get_payout(reporter, &request_id) {
                if payout.claimable > 0 {
                    total_claimed += h.engine.claim(reporter, &request_id);
                }
            }
        }

        let treasury_after = h.token.balance(&h.treasury);
        let audit_after = h.token.balance(&h.audit_fund);
        let total_out = total_claimed
            + (treasury_after - treasury_before)
            + (audit_after - audit_before);
        let diff = total_in - total_out;

        prop_assert!(
            diff >= 0 && diff <= (n_reporters + 1) as i128,
            "accounting: total_in={} total_out={} diff={}",
            total_in, total_out, diff
        );
    }
}

// ---------------------------------------------------------------------------
// Weighted median with realistic West African NGN prices
// ---------------------------------------------------------------------------

#[test]
fn test_weighted_median_ngn_rice50_prices() {
    // NGN at 2 decimal places: 82,750 NGN stored as 8_275_000
    let prices: [(i128, u32); 7] = [
        (8_250_000, 1_500),
        (8_300_000, 1_000),
        (8_200_000, 1_200),
        (8_275_000, 800),
        (8_320_000, 900),
        (8_180_000, 600),
        (20_000_000, 200), // outlier with low weight
    ];
    let median = marketpulse_shared::weighted_median(&prices).unwrap();
    assert!(
        median >= 8_200_000 && median <= 8_320_000,
        "median={} out of NGN cluster",
        median
    );
}

#[test]
fn test_weighted_median_ngn_tomato_prices() {
    // Tomato ~4,200 NGN stored as 420_000 (2 dp)
    let prices: [(i128, u32); 5] = [
        (420_000, 1_000),
        (430_000, 1_000),
        (410_000, 1_000),
        (425_000, 1_000),
        (100_000, 200), // outlier
    ];
    let median = marketpulse_shared::weighted_median(&prices).unwrap();
    assert!(
        median >= 410_000 && median <= 430_000,
        "tomato median={}",
        median
    );
}

// ---------------------------------------------------------------------------
// Resource-budget test at max_reports = 15
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_at_max_reports_15_completes() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 300_000_000);
    let request_id = h.make_request(&requester, 150_000_000);

    let n = DEFAULT_MAX_REPORTS_CAP as usize;
    let stake = DEFAULT_MIN_STAKE_NEW_REPORTER;
    let reporters: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(env)).collect();
    let salts: [[u8; 32]; 15] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 100;
        s
    });

    for i in 0..n {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(800_000, &salts[i]);
        h.engine.commit(&reporters[i], &request_id, &c, &stake);
    }
    h.advance_to_reveal(request_id);
    for i in 0..n {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0x22u8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &800_000i128, &salt, &ev);
    }
    h.advance_past_reveal(request_id);

    let resolution = h.engine.resolve(&request_id);
    assert_eq!(resolution.n_accepted, 15);
    assert_eq!(resolution.median_value, 800_000);
}

// ---------------------------------------------------------------------------
// Commit beyond max_reports → MaxReportsReached
// ---------------------------------------------------------------------------

#[test]
fn test_commit_beyond_max_reports_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let now = env.ledger().timestamp();
    let params = marketpulse_shared::RequestParams {
        data_type: Symbol::new(env, "RICE50"),
        geohash: BytesN::from_array(env, b"s14b3k9x"),
        bounty: 50_000_000,
        token: h.token_addr.clone(),
        min_stake: DEFAULT_MIN_STAKE_NEW_REPORTER,
        tolerance_bps: 800,
        commit_deadline: now + 3_600,
        reveal_deadline: now + 7_200,
        challenge_window: 86_400,
        min_reports: 3,
        max_reports: 3,
    };
    let request_id = h.board.create_request(&requester, &params);

    let reporters: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(env)).collect();
    for reporter in &reporters {
        h.enroll_reporter(reporter);
        h.mint_and_fund(reporter, 10_000_000);
    }
    for i in 0..3 {
        let c = h.make_commitment(800_000, &[i as u8; 32]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &c,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }
    let c = h.make_commitment(800_000, &[99u8; 32]);
    let res = h.engine.try_commit(
        &reporters[3],
        &request_id,
        &c,
        &DEFAULT_MIN_STAKE_NEW_REPORTER,
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::MaxReportsReached);
}

// ---------------------------------------------------------------------------
// Double reveal → AlreadyRevealed
// ---------------------------------------------------------------------------

#[test]
fn test_double_reveal_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    let value = 800_000i128;
    let salt = [7u8; 32];
    let c = h.make_commitment(value, &salt);
    h.engine
        .commit(&reporter, &request_id, &c, &DEFAULT_MIN_STAKE_NEW_REPORTER);

    h.advance_to_reveal(request_id);
    let salt_b = BytesN::from_array(env, &salt);
    let ev = BytesN::from_array(env, &[0u8; 32]);
    h.engine
        .reveal(&reporter, &request_id, &value, &salt_b, &ev);

    let res = h
        .engine
        .try_reveal(&reporter, &request_id, &value, &salt_b, &ev);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyRevealed);
}

// ---------------------------------------------------------------------------
// Stake too low / exceeds cap
// ---------------------------------------------------------------------------

#[test]
fn test_stake_too_low_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 10_000_000);

    let c = h.make_commitment(800_000, &[8u8; 32]);
    let res = h.engine.try_commit(
        &reporter,
        &request_id,
        &c,
        &(DEFAULT_MIN_STAKE_NEW_REPORTER - 1),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::StakeTooLow);
}

#[test]
fn test_stake_exceeds_cap_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);
    let reporter = Address::generate(env);
    h.enroll_reporter(&reporter);
    h.mint_and_fund(&reporter, 200_000_000);

    let c = h.make_commitment(800_000, &[9u8; 32]);
    let over_cap = marketpulse_shared::DEFAULT_STAKE_CAP_TIER_1 + 1;
    let res = h.engine.try_commit(&reporter, &request_id, &c, &over_cap);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::StakeExceedsCap);
}

// ---------------------------------------------------------------------------
// Finalise before challenge window → ChallengeWindowActive
// ---------------------------------------------------------------------------

#[test]
fn test_finalise_before_challenge_window_rejected() {
    let h = TestHarness::setup();
    let env = &h.env;

    let requester = Address::generate(env);
    h.mint_and_fund(&requester, 100_000_000);
    let request_id = h.make_request(&requester, 50_000_000);

    let reporters: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(env)).collect();
    let salts: [[u8; 32]; 3] = core::array::from_fn(|i| {
        let mut s = [0u8; 32];
        s[0] = i as u8 + 60;
        s
    });

    for i in 0..3 {
        h.enroll_reporter(&reporters[i]);
        h.mint_and_fund(&reporters[i], 10_000_000);
        let c = h.make_commitment(800_000, &salts[i]);
        h.engine.commit(
            &reporters[i],
            &request_id,
            &c,
            &DEFAULT_MIN_STAKE_NEW_REPORTER,
        );
    }
    h.advance_to_reveal(request_id);
    for i in 0..3 {
        let salt = BytesN::from_array(env, &salts[i]);
        let ev = BytesN::from_array(env, &[0x55u8; 32]);
        h.engine
            .reveal(&reporters[i], &request_id, &800_000i128, &salt, &ev);
    }
    h.advance_past_reveal(request_id);
    h.engine.resolve(&request_id);

    // Challenge window not yet over
    let res = h.engine.try_finalise(&request_id);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::ChallengeWindowActive
    );
}
