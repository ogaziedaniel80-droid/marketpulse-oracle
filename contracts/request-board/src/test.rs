#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, BytesN, Env};

fn setup_test_env() -> (
    Env,
    RequestBoardContractClient<'static>,
    Address,
    token::Client<'static>,
    token::StellarAssetClient<'static>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::Client::new(&env, &token_contract.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract.address());

    let board_id = env.register(RequestBoardContract, ());
    let board_client = RequestBoardContractClient::new(&env, &board_id);

    board_client.initialize(&admin);

    (
        env,
        board_client,
        admin,
        token_client,
        token_admin_client,
        token_contract.address(),
    )
}

fn valid_params(env: &Env, token_address: &Address) -> RequestParams {
    let now = env.ledger().timestamp();
    RequestParams {
        data_type: Symbol::new(env, "RICE50"),
        geohash: BytesN::from_array(env, &[b's', b'1', b'4', b'b', b'3', b'k', b'9', b'x']),
        bounty: 50_000_000, // 5 USDC
        token: token_address.clone(),
        min_stake: DEFAULT_MIN_STAKE_NEW_REPORTER,
        tolerance_bps: 800,
        commit_deadline: now + 3_600,
        reveal_deadline: now + 7_200,
        challenge_window: 86_400,
        min_reports: 5,
        max_reports: 15,
    }
}

#[test]
fn test_happy_path_create_view_and_cancel_with_exact_balance_accounting() {
    let (env, board, _admin, token, token_admin, token_addr) = setup_test_env();

    let requester = Address::generate(&env);
    token_admin.mint(&requester, &100_000_000); // 10 USDC

    let params = valid_params(&env, &token_addr);
    let bounty = params.bounty;

    let req_id = board.create_request(&requester, &params);
    assert_eq!(req_id, 1);

    // Requester debited, contract credited
    assert_eq!(token.balance(&requester), 100_000_000 - bounty);
    assert_eq!(token.balance(&board.address), bounty);

    // View request
    let request = board.get_request(&req_id);
    assert_eq!(request.status, RequestStatus::Open);
    assert_eq!(request.bounty, bounty);
    assert_eq!(board.request_status(&req_id), RequestStatus::Open);

    // Cancel before commits -> Full refund
    board.cancel_request(&requester, &req_id);

    assert_eq!(token.balance(&requester), 100_000_000);
    assert_eq!(token.balance(&board.address), 0);
    assert_eq!(board.request_status(&req_id), RequestStatus::Cancelled);
}

#[test]
fn test_create_request_param_validations() {
    let (env, board, _admin, _token, token_admin, token_addr) = setup_test_env();
    let requester = Address::generate(&env);
    token_admin.mint(&requester, &1_000_000_000);

    // 1. Bounty too low (< 3 USDC = 30_000_000)
    let mut params = valid_params(&env, &token_addr);
    params.bounty = 20_000_000;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::BountyTooLow);

    // 2. Unsupported data type
    let mut params = valid_params(&env, &token_addr);
    params.data_type = Symbol::new(&env, "UNKNOWN_CROP");
    let res = board.try_create_request(&requester, &params);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::UnsupportedDataType
    );

    // 3. Commit deadline in past
    let mut params = valid_params(&env, &token_addr);
    params.commit_deadline = 0;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::DeadlinePassed);

    // 4. Invalid deadline order (reveal <= commit)
    let mut params = valid_params(&env, &token_addr);
    params.reveal_deadline = params.commit_deadline;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::InvalidDeadlineOrder
    );

    // 5. Min reports too low (< 3)
    let mut params = valid_params(&env, &token_addr);
    params.min_reports = 2;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::MinReportsTooLow);

    // 6. Max reports exceeds cap (> 15)
    let mut params = valid_params(&env, &token_addr);
    params.max_reports = 16;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::MaxReportsExceedsCap
    );

    // 7. Min reports > Max reports
    let mut params = valid_params(&env, &token_addr);
    params.min_reports = 10;
    params.max_reports = 8;
    let res = board.try_create_request(&requester, &params);
    assert_eq!(
        res.unwrap_err().unwrap(),
        ContractError::MinReportsExceedsMax
    );
}

#[test]
fn test_cancel_rejected_when_commits_exist() {
    let (env, board, admin, _token, token_admin, token_addr) = setup_test_env();
    let requester = Address::generate(&env);
    token_admin.mint(&requester, &100_000_000);

    let params = valid_params(&env, &token_addr);
    let req_id = board.create_request(&requester, &params);

    // Authorize ReportEngine and record commit
    let engine = Address::generate(&env);
    board.set_authorized_caller(&admin, &engine, &true);
    board.record_commit(&engine, &req_id);

    // Requester attempts cancel after commit -> Rejected
    let res = board.try_cancel_request(&requester, &req_id);
    assert_eq!(res.unwrap_err().unwrap(), ContractError::CommitmentsExist);
}

#[test]
fn test_undersubscribed_refund_path() {
    let (env, board, _admin, token, token_admin, token_addr) = setup_test_env();
    let requester = Address::generate(&env);
    token_admin.mint(&requester, &100_000_000);

    let params = valid_params(&env, &token_addr);
    let _bounty = params.bounty;
    let req_id = board.create_request(&requester, &params);

    // Fast-forward ledger past commit deadline
    env.ledger().set_timestamp(params.commit_deadline + 10);

    // Caller executes under-subscribed refund (with commit_count 2 < min_reports 5)
    let caller = Address::generate(&env);
    board.cancel_undersubscribed(&caller, &req_id, &2);

    // Requester refunded in full
    assert_eq!(token.balance(&requester), 100_000_000);
    assert_eq!(token.balance(&board.address), 0);
    assert_eq!(board.request_status(&req_id), RequestStatus::Cancelled);
}

#[test]
fn test_approved_data_types_admin() {
    let (env, board, admin, _token, _token_admin, _token_addr) = setup_test_env();

    // Launch types approved by default
    assert!(board.is_approved_data_type(&Symbol::new(&env, "RICE50")));
    assert!(board.is_approved_data_type(&Symbol::new(&env, "TOMATO")));
    assert!(!board.is_approved_data_type(&Symbol::new(&env, "NEW_TYPE")));

    // Admin adds type
    board.add_data_type(&admin, &Symbol::new(&env, "NEW_TYPE"));
    assert!(board.is_approved_data_type(&Symbol::new(&env, "NEW_TYPE")));

    // Admin removes type
    board.remove_data_type(&admin, &Symbol::new(&env, "NEW_TYPE"));
    assert!(!board.is_approved_data_type(&Symbol::new(&env, "NEW_TYPE")));
}

#[test]
fn test_list_open_requests_pagination() {
    let (env, board, _admin, _token, token_admin, token_addr) = setup_test_env();
    let requester = Address::generate(&env);
    token_admin.mint(&requester, &500_000_000);

    let params = valid_params(&env, &token_addr);
    board.create_request(&requester, &params);
    board.create_request(&requester, &params);
    board.create_request(&requester, &params);

    let open_reqs = board.list_open_requests(&1, &2);
    assert_eq!(open_reqs.len(), 2);

    let open_reqs_page2 = board.list_open_requests(&3, &2);
    assert_eq!(open_reqs_page2.len(), 1);
}
