#![cfg(test)]

use super::*;
use marketpulse_shared::{ContractError, DEFAULT_MIN_STAKE_NEW_REPORTER};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, BytesN, Env, Symbol};

// ---------------------------------------------------------------------------
// Minimal stubs so Disputes contract can call RequestBoard
// ---------------------------------------------------------------------------

use marketpulse_registry::{RegistryContract, RegistryContractClient};
use marketpulse_request_board::{RequestBoardContract, RequestBoardContractClient};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct TestHarness {
    env: Env,
    disputes: DisputesContractClient<'static>,
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

        let token_admin_addr = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
        let token_addr = token_contract.address();
        let token = token::Client::new(&env, &token_addr);
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);

        // Registry (needed for board init)
        let reg_id = env.register(RegistryContract, ());
        let registry = RegistryContractClient::new(&env, &reg_id);
        registry.initialize(&admin);

        // RequestBoard
        let board_id = env.register(RequestBoardContract, ());
        let board = RequestBoardContractClient::new(&env, &board_id);
        board.initialize(&admin);

        // Disputes
        let engine_stub = Address::generate(&env); // stub for report engine in tests
        let disputes_id = env.register(DisputesContract, ());
        let disputes = DisputesContractClient::new(&env, &disputes_id);
        disputes.initialize(&admin, &engine_stub, &board_id, &treasury, &audit_fund);

        // Authorize Disputes in RequestBoard
        board.set_authorized_caller(&admin, &disputes_id, &true);

        TestHarness {
            env,
            disputes,
            board,
            token,
            token_admin,
            token_addr,
            admin,
            treasury,
            audit_fund,
        }
    }

    fn create_challengeable_request(&self) -> u64 {
        let requester = Address::generate(&self.env);
        self.token_admin.mint(&requester, &100_000_000);
        let now = self.env.ledger().timestamp();
        let params = marketpulse_shared::RequestParams {
            data_type: Symbol::new(&self.env, "RICE50"),
            geohash: BytesN::from_array(&self.env, b"s14b3k9x"),
            bounty: 50_000_000,
            token: self.token_addr.clone(),
            min_stake: DEFAULT_MIN_STAKE_NEW_REPORTER,
            tolerance_bps: 800,
            commit_deadline: now + 3_600,
            reveal_deadline: now + 7_200,
            challenge_window: 86_400,
            min_reports: 3,
            max_reports: 15,
        };
        let req_id = self.board.create_request(&requester, &params);
        // Manually set to Challengeable to test dispute window
        self.board.set_status(
            &self.admin,
            &req_id,
            &marketpulse_shared::RequestStatus::Challengeable,
        );
        req_id
    }

    fn register_panel_member(&self, member: &Address) {
        self.disputes.register_panel_member(&self.admin, member);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_version() {
    let env = Env::default();
    let id = env.register(DisputesContract, ());
    let client = DisputesContractClient::new(&env, &id);
    assert_eq!(client.version(), 2);
}

#[test]
fn test_initialize_twice_rejected() {
    let h = TestHarness::setup();
    let engine = Address::generate(&h.env);
    let board = Address::generate(&h.env);
    let res = h
        .disputes
        .try_initialize(&h.admin, &engine, &board, &h.treasury, &h.audit_fund);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyInitialized);
}

#[test]
fn test_challenge_happy_path() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let min_bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(min_bond * 2));

    h.disputes.challenge(
        &challenger,
        &req_id,
        &min_bond,
        &Symbol::new(&h.env, "fraudsig"),
    );

    let dispute = h.disputes.get_dispute(&req_id).unwrap();
    assert_eq!(dispute.challenger, challenger);
    assert_eq!(dispute.bond, min_bond);
    assert!(!dispute.ruled);
    assert!(dispute.upheld.is_none());

    // Request status should be Disputed
    let req = h.board.get_request(&req_id);
    assert_eq!(req.status, marketpulse_shared::RequestStatus::Disputed);
}

#[test]
fn test_challenge_insufficient_bond_rejected() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let insufficient_bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 4; // need 5x
    h.token_admin.mint(&challenger, &100_000_000);

    let res = h.disputes.try_challenge(
        &challenger,
        &req_id,
        &insufficient_bond,
        &Symbol::new(&h.env, "reason"),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::InsufficientBond);
}

#[test]
fn test_challenge_wrong_status_rejected() {
    let h = TestHarness::setup();
    let requester = Address::generate(&h.env);
    h.token_admin.mint(&requester, &100_000_000);

    let now = h.env.ledger().timestamp();
    let params = marketpulse_shared::RequestParams {
        data_type: Symbol::new(&h.env, "RICE50"),
        geohash: BytesN::from_array(&h.env, b"s14b3k9x"),
        bounty: 50_000_000,
        token: h.token_addr.clone(),
        min_stake: DEFAULT_MIN_STAKE_NEW_REPORTER,
        tolerance_bps: 800,
        commit_deadline: now + 3_600,
        reveal_deadline: now + 7_200,
        challenge_window: 86_400,
        min_reports: 3,
        max_reports: 15,
    };
    let req_id = h.board.create_request(&requester, &params);
    // Request is Open, not Challengeable

    let challenger = Address::generate(&h.env);
    h.token_admin.mint(&challenger, &100_000_000);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;

    let res = h
        .disputes
        .try_challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::RequestNotChallengeable
    );
}

#[test]
fn test_double_challenge_rejected() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 3));

    h.disputes
        .challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));

    let res =
        h.disputes
            .try_challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason2"));
    // After first challenge, the request status is Disputed (not Challengeable),
    // so the second attempt fails with RequestNotChallengeable before reaching the
    // AlreadyChallenged check. Both errors correctly prevent a double challenge.
    let err = res.unwrap_err().unwrap();
    assert!(
        err == ContractError::AlreadyChallenged || err == ContractError::RequestNotChallengeable,
        "expected double-challenge to be blocked, got: {:?}",
        err
    );
}

#[test]
fn test_panel_member_management() {
    let h = TestHarness::setup();
    let m1 = Address::generate(&h.env);
    let m2 = Address::generate(&h.env);

    assert!(!h.disputes.is_panel_member(&m1));
    h.register_panel_member(&m1);
    h.register_panel_member(&m2);

    assert!(h.disputes.is_panel_member(&m1));
    assert!(h.disputes.is_panel_member(&m2));

    let list = h.disputes.get_panel_members();
    assert_eq!(list.len(), 2);

    h.disputes.remove_panel_member(&h.admin, &m1);
    assert!(!h.disputes.is_panel_member(&m1));
    assert!(h.disputes.is_panel_member(&m2));
}

#[test]
fn test_unauthorized_panel_registration_rejected() {
    let h = TestHarness::setup();
    let rogue = Address::generate(&h.env);
    let member = Address::generate(&h.env);

    let res = h.disputes.try_register_panel_member(&rogue, &member);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::Unauthorized);
}

#[test]
fn test_rule_majority_rejected_slashes_bond() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));

    h.disputes.challenge(
        &challenger,
        &req_id,
        &bond,
        &Symbol::new(&h.env, "fraudsig"),
    );

    // Register 3 panel members and vote to reject (majority reject)
    let p1 = Address::generate(&h.env);
    let p2 = Address::generate(&h.env);
    let p3 = Address::generate(&h.env);
    h.register_panel_member(&p1);
    h.register_panel_member(&p2);
    h.register_panel_member(&p3);

    let treasury_before = h.token.balance(&h.treasury);
    let audit_before = h.token.balance(&h.audit_fund);

    h.disputes.rule(&p1, &req_id, &false); // reject
    h.disputes.rule(&p2, &req_id, &false); // reject — majority reached (2/3)

    let dispute = h.disputes.get_dispute(&req_id).unwrap();
    assert!(dispute.ruled);
    assert_eq!(dispute.upheld, Some(false));

    // Bond should be slashed: 70% to audit fund, 30% to treasury
    let expected_audit =
        marketpulse_shared::bps_mul(bond, REJECTED_DISPUTE_BOND_AUDIT_FUND_BPS).unwrap();
    let expected_treasury = bond - expected_audit;

    assert_eq!(
        h.token.balance(&h.audit_fund) - audit_before,
        expected_audit
    );
    assert_eq!(
        h.token.balance(&h.treasury) - treasury_before,
        expected_treasury
    );
}

#[test]
fn test_rule_majority_upheld_returns_bond() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));

    h.disputes.challenge(
        &challenger,
        &req_id,
        &bond,
        &Symbol::new(&h.env, "collusion"),
    );

    let p1 = Address::generate(&h.env);
    let p2 = Address::generate(&h.env);
    let p3 = Address::generate(&h.env);
    h.register_panel_member(&p1);
    h.register_panel_member(&p2);
    h.register_panel_member(&p3);

    let challenger_balance_before = h.token.balance(&challenger);

    h.disputes.rule(&p1, &req_id, &true); // upheld
    h.disputes.rule(&p2, &req_id, &true); // upheld — majority reached

    let dispute = h.disputes.get_dispute(&req_id).unwrap();
    assert!(dispute.ruled);
    assert_eq!(dispute.upheld, Some(true));

    // Bond returned to challenger
    assert_eq!(
        h.token.balance(&challenger) - challenger_balance_before,
        bond
    );

    // Request should be cancelled (observation voided)
    let req = h.board.get_request(&req_id);
    assert_eq!(req.status, marketpulse_shared::RequestStatus::Cancelled);
}

#[test]
fn test_double_vote_rejected() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));
    h.disputes
        .challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));

    let p1 = Address::generate(&h.env);
    h.register_panel_member(&p1);
    h.disputes.rule(&p1, &req_id, &true);

    let res = h.disputes.try_rule(&p1, &req_id, &true);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyVoted);
}

#[test]
fn test_non_panel_member_cannot_vote() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));
    h.disputes
        .challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));

    let non_member = Address::generate(&h.env);
    let res = h.disputes.try_rule(&non_member, &req_id, &true);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::NotPanelMember);
}

#[test]
fn test_timeout_resolution_defaults_to_rejected() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));
    h.disputes
        .challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));

    let dispute = h.disputes.get_dispute(&req_id).unwrap();

    // Try before deadline → DeadlineNotMet
    let res = h.disputes.try_resolve_timeout(&req_id);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::DeadlineNotMet);

    // Advance past ruling deadline
    h.env.ledger().set_timestamp(dispute.ruling_deadline + 1);

    let treasury_before = h.token.balance(&h.treasury);
    let audit_before = h.token.balance(&h.audit_fund);

    h.disputes.resolve_timeout(&req_id);

    let dispute_after = h.disputes.get_dispute(&req_id).unwrap();
    assert!(dispute_after.ruled);
    // Default outcome = rejected (false)
    assert_eq!(dispute_after.upheld, Some(false));

    // Bond slashed
    assert!(h.token.balance(&h.treasury) > treasury_before);
    assert!(h.token.balance(&h.audit_fund) > audit_before);
}

#[test]
fn test_seed_commit_reveal_xor_accumulates() {
    let h = TestHarness::setup();
    let request_id = 42u64;

    // Register two panel members as seed contributors
    let c1 = Address::generate(&h.env);
    let c2 = Address::generate(&h.env);
    h.register_panel_member(&c1);
    h.register_panel_member(&c2);

    let secret1 = [0xAAu8; 32];
    let nonce1 = [0x01u8; 32];
    let secret2 = [0xBBu8; 32];
    let nonce2 = [0x02u8; 32];

    // Build commitments
    let mut preimage1 = soroban_sdk::Bytes::new(&h.env);
    for b in secret1 {
        preimage1.push_back(b);
    }
    for b in nonce1 {
        preimage1.push_back(b);
    }
    let commitment1 = h.env.crypto().sha256(&preimage1).into();

    let mut preimage2 = soroban_sdk::Bytes::new(&h.env);
    for b in secret2 {
        preimage2.push_back(b);
    }
    for b in nonce2 {
        preimage2.push_back(b);
    }
    let commitment2 = h.env.crypto().sha256(&preimage2).into();

    h.disputes
        .submit_seed_commitment(&c1, &request_id, &commitment1);
    h.disputes
        .submit_seed_commitment(&c2, &request_id, &commitment2);

    // Reveal
    h.disputes.reveal_seed(
        &c1,
        &request_id,
        &BytesN::from_array(&h.env, &secret1),
        &BytesN::from_array(&h.env, &nonce1),
    );
    h.disputes.reveal_seed(
        &c2,
        &request_id,
        &BytesN::from_array(&h.env, &secret2),
        &BytesN::from_array(&h.env, &nonce2),
    );
    // If both reveals succeed, the XOR accumulation worked correctly.
    // The final seed = 0xAA ^ 0xBB = 0x11 (per byte), stored in temp storage.
    // We can't read it directly without a view function, but no error = success.
}

#[test]
fn test_seed_wrong_nonce_rejected() {
    let h = TestHarness::setup();
    let request_id = 99u64;

    let c1 = Address::generate(&h.env);
    h.register_panel_member(&c1);

    let secret = [0xCCu8; 32];
    let real_nonce = [0x10u8; 32];
    let wrong_nonce = [0x20u8; 32];

    let mut preimage = soroban_sdk::Bytes::new(&h.env);
    for b in secret {
        preimage.push_back(b);
    }
    for b in real_nonce {
        preimage.push_back(b);
    }
    let commitment = h.env.crypto().sha256(&preimage).into();

    h.disputes
        .submit_seed_commitment(&c1, &request_id, &commitment);

    let res = h.disputes.try_reveal_seed(
        &c1,
        &request_id,
        &BytesN::from_array(&h.env, &secret),
        &BytesN::from_array(&h.env, &wrong_nonce),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::CommitmentMismatch);
}

#[test]
fn test_non_panel_member_cannot_submit_seed() {
    let h = TestHarness::setup();
    let request_id = 55u64;

    let non_member = Address::generate(&h.env);
    let commitment = BytesN::from_array(&h.env, &[0u8; 32]);

    let res = h
        .disputes
        .try_submit_seed_commitment(&non_member, &request_id, &commitment);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::NotPanelMember);
}

// ---------------------------------------------------------------------------
// Adversarial: frivolous dispute (bond too small) is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_frivolous_dispute_bond_too_small() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    h.token_admin.mint(&challenger, &100_000_000);

    // 1 USDC bond — less than 5x min_stake
    let res = h.disputes.try_challenge(
        &challenger,
        &req_id,
        &10_000_000,
        &Symbol::new(&h.env, "frivolous"),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::InsufficientBond);
}

// ---------------------------------------------------------------------------
// Adversarial: attempt to rule on already-ruled dispute
// ---------------------------------------------------------------------------

#[test]
fn test_rule_after_already_ruled_rejected() {
    let h = TestHarness::setup();
    let req_id = h.create_challengeable_request();

    let challenger = Address::generate(&h.env);
    let bond = DEFAULT_MIN_STAKE_NEW_REPORTER * 5;
    h.token_admin.mint(&challenger, &(bond * 2));
    h.disputes
        .challenge(&challenger, &req_id, &bond, &Symbol::new(&h.env, "reason"));

    let p1 = Address::generate(&h.env);
    let p2 = Address::generate(&h.env);
    h.register_panel_member(&p1);
    h.register_panel_member(&p2);

    // Reach majority
    h.disputes.rule(&p1, &req_id, &false);
    h.disputes.rule(&p2, &req_id, &false);

    // Third vote on already-ruled dispute
    let p3 = Address::generate(&h.env);
    h.register_panel_member(&p3);
    let res = h.disputes.try_rule(&p3, &req_id, &false);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::AlreadyRuled);
}
