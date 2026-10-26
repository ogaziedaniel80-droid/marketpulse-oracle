#!/usr/bin/env bash
# scripts/deploy-testnet.sh
#
# Deploys all MarketPulse Oracle contracts to Stellar Testnet (or local network).
# Wires cross-contract addresses, initialises parameters, and writes contract IDs
# to .env.local. Never prints secrets.
#
# Usage:
#   ./scripts/deploy-testnet.sh [--network testnet|local] [--identity <key-name>]
#
# Prerequisites:
#   - stellar CLI installed (stellar --version → 28.0.0)
#   - A funded testnet identity: stellar keys generate deployer --network testnet --fund
#   - USDC_SAC_ID set in .env or passed via environment
#
# Per README section 14.5 and 18.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-deployer}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --network) NETWORK="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ "$NETWORK" == "local" ]]; then
  RPC_URL="${LOCAL_RPC_URL:-http://localhost:8000/soroban/rpc}"
  NETWORK_PASSPHRASE="${LOCAL_NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
fi

WASM_DIR="target/wasm32v1-none/release"
ENV_LOCAL=".env.local"

echo "=========================================="
echo " MarketPulse Oracle — Deploy"
echo " Network : $NETWORK"
echo " Identity: $IDENTITY"
echo " RPC     : $RPC_URL"
echo "=========================================="

# ---------------------------------------------------------------------------
# Require USDC SAC address
# ---------------------------------------------------------------------------
if [[ -z "${USDC_SAC_ID:-}" ]]; then
  # Load from .env if present
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    source <(grep -v '^#' .env | grep '=' | sed 's/^/export /')
  fi
fi

if [[ -z "${USDC_SAC_ID:-}" ]]; then
  echo "ERROR: USDC_SAC_ID is not set. Export it or add it to .env."
  echo "  For testnet, create a test USDC token first:"
  echo "    stellar contract asset deploy --asset USDC:G... --network testnet --source $IDENTITY"
  exit 1
fi

if [[ -z "${TREASURY_ADDRESS:-}" ]] || [[ -z "${AUDIT_FUND_ADDRESS:-}" ]]; then
  echo "ERROR: TREASURY_ADDRESS and AUDIT_FUND_ADDRESS must be set in .env"
  exit 1
fi

echo ""
echo "Building optimised Wasm artifacts..."
stellar contract build 2>&1 | tail -5

# ---------------------------------------------------------------------------
# Helper: deploy a contract, idempotent if ID already in .env.local
# ---------------------------------------------------------------------------
deploy_contract() {
  local name="$1"        # e.g. "REGISTRY"
  local wasm_file="$2"   # e.g. "marketpulse_registry.wasm"
  local env_key="${name}_ID"

  # Check if already deployed (idempotent)
  if [[ -f "$ENV_LOCAL" ]]; then
    existing=$(grep "^${env_key}=" "$ENV_LOCAL" | cut -d= -f2 || true)
    if [[ -n "$existing" ]]; then
      echo "  [skip] $name already deployed: $existing"
      echo "$existing"
      return
    fi
  fi

  echo "  Deploying $name..."
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$WASM_DIR/$wasm_file" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    2>&1 | grep -E '^C[A-Z0-9]{55}$' | tail -1)

  if [[ -z "$contract_id" ]]; then
    echo "ERROR: Failed to deploy $name — no contract ID found in output"
    exit 1
  fi

  echo "  $name deployed: $contract_id"

  # Write to .env.local (append or create)
  if grep -q "^${env_key}=" "$ENV_LOCAL" 2>/dev/null; then
    sed -i "s|^${env_key}=.*|${env_key}=${contract_id}|" "$ENV_LOCAL"
  else
    echo "${env_key}=${contract_id}" >> "$ENV_LOCAL"
  fi

  echo "$contract_id"
}

# ---------------------------------------------------------------------------
# Helper: invoke a contract initialisation function
# ---------------------------------------------------------------------------
invoke() {
  local contract_id="$1"
  local fn="$2"
  shift 2
  stellar contract invoke \
    --id "$contract_id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- "$fn" "$@"
}

# ---------------------------------------------------------------------------
# Create .env.local if it doesn't exist
# ---------------------------------------------------------------------------
touch "$ENV_LOCAL"

# Get deployer address (never print the secret)
DEPLOYER_ADDRESS=$(stellar keys address "$IDENTITY" 2>/dev/null)
echo "Deployer address: $DEPLOYER_ADDRESS"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Deploy all contracts
# ---------------------------------------------------------------------------
echo "--- Step 1: Deploy contracts ---"

REGISTRY_ID=$(deploy_contract    "REGISTRY_ID"      "marketpulse_registry.wasm")
BOARD_ID=$(deploy_contract       "REQUEST_BOARD_ID"  "marketpulse_request_board.wasm")
ENGINE_ID=$(deploy_contract      "REPORT_ENGINE_ID"  "marketpulse_report_engine.wasm")
DISPUTES_ID=$(deploy_contract    "DISPUTES_ID"       "marketpulse_disputes.wasm")
FEED_ID=$(deploy_contract        "ORACLE_FEED_ID"    "marketpulse_oracle_feed.wasm")

# Write USDC SAC ID to .env.local
if ! grep -q "^USDC_SAC_ID=" "$ENV_LOCAL" 2>/dev/null; then
  echo "USDC_SAC_ID=${USDC_SAC_ID}" >> "$ENV_LOCAL"
fi

echo ""
echo "--- Step 2: Initialize Registry ---"
invoke "$REGISTRY_ID" initialize \
  --admin "$DEPLOYER_ADDRESS"

echo ""
echo "--- Step 3: Initialize RequestBoard ---"
invoke "$BOARD_ID" initialize \
  --admin "$DEPLOYER_ADDRESS"

echo ""
echo "--- Step 4: Initialize ReportEngine ---"
invoke "$ENGINE_ID" initialize \
  --admin         "$DEPLOYER_ADDRESS" \
  --registry      "$REGISTRY_ID" \
  --request_board "$BOARD_ID" \
  --oracle_feed   "$FEED_ID" \
  --treasury      "$TREASURY_ADDRESS" \
  --audit_fund    "$AUDIT_FUND_ADDRESS"

echo ""
echo "--- Step 5: Initialize OracleFeed ---"
invoke "$FEED_ID" initialize \
  --admin  "$DEPLOYER_ADDRESS" \
  --writer "$ENGINE_ID"

echo ""
echo "--- Step 6: Initialize Disputes ---"
invoke "$DISPUTES_ID" initialize \
  --admin         "$DEPLOYER_ADDRESS" \
  --report_engine "$ENGINE_ID" \
  --request_board "$BOARD_ID" \
  --treasury      "$TREASURY_ADDRESS" \
  --audit_fund    "$AUDIT_FUND_ADDRESS"

echo ""
echo "--- Step 7: Wire cross-contract authorizations ---"

# Registry: authorize ReportEngine to call update_reputation / reset_reputation_fraud
invoke "$REGISTRY_ID" set_authorized_caller \
  --admin "$DEPLOYER_ADDRESS" --caller "$ENGINE_ID" --authorized true

# RequestBoard: authorize ReportEngine to call record_commit / set_status / release_funds
invoke "$BOARD_ID" set_authorized_caller \
  --admin "$DEPLOYER_ADDRESS" --caller "$ENGINE_ID" --authorized true

# RequestBoard: authorize Disputes to call set_status
invoke "$BOARD_ID" set_authorized_caller \
  --admin "$DEPLOYER_ADDRESS" --caller "$DISPUTES_ID" --authorized true

# ReportEngine: register Disputes address for fraud hook
invoke "$ENGINE_ID" set_disputes_address \
  --admin "$DEPLOYER_ADDRESS" --disputes "$DISPUTES_ID"

echo ""
echo "=========================================="
echo " Deployment complete!"
echo " Contract IDs written to: $ENV_LOCAL"
echo "=========================================="
echo ""
cat "$ENV_LOCAL"

echo ""
echo "Next: run 'pnpm bindings:generate' to generate TypeScript clients."
echo "Then: run 'pnpm seed:demo' to seed demo data."
