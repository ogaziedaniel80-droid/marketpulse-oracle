# Running Against a Local Soroban Network

This guide covers how to spin up a local Stellar/Soroban standalone node and
deploy MarketPulse Oracle contracts against it for development.

## Prerequisites

- Docker and Docker Compose installed
- Stellar CLI 28.0.0 (`stellar --version`)
- Contracts built: `stellar contract build`

## Option A — Stellar CLI local network (recommended)

Stellar CLI ships a built-in local network command:

```bash
# Start a local Stellar node (foreground; Ctrl-C to stop)
stellar network start local
```

This spins up a standalone Stellar node on `http://localhost:8000`.
It creates a default funded account (`alice`) you can use as the deployer.

In a second terminal:

```bash
# Fund a deployer key from the local node's root account
stellar keys generate deployer --network local
stellar keys fund deployer --network local

# Deploy all contracts
STELLAR_NETWORK=local \
USDC_SAC_ID=<your-test-USDC-SAC> \
TREASURY_ADDRESS=$(stellar keys address deployer) \
AUDIT_FUND_ADDRESS=$(stellar keys address deployer) \
./scripts/deploy-testnet.sh --network local

# Generate bindings against local deployment
STELLAR_NETWORK=local node scripts/bindings-generate.js
```

> **USDC on local network**: Deploy a test USDC asset first:
>
> ```bash
> stellar contract asset deploy \
>   --asset USDC:$(stellar keys address deployer) \
>   --network local \
>   --source deployer
> ```

## Option B — Docker Compose with quickstart image

```bash
# Start local infrastructure (Postgres, Redis, MinIO) alongside a local Stellar node
docker compose -f infra/docker/compose.dev.yml up -d
```

The compose file does not yet include a Stellar quickstart container. To add one,
append this service to `infra/docker/compose.dev.yml`:

```yaml
stellar-quickstart:
  image: stellar/quickstart:testing
  ports:
    - '8000:8000'
  environment:
    - ENABLE_SOROBAN_RPC=true
  command: --standalone --enable-soroban-rpc
```

Then set:

```bash
export LOCAL_RPC_URL=http://localhost:8000/soroban/rpc
export LOCAL_NETWORK_PASSPHRASE="Standalone Network ; February 2017"
```

## Environment variables for local deployment

| Variable                     | Value for local                      |
| ---------------------------- | ------------------------------------ |
| `STELLAR_NETWORK`            | `local`                              |
| `STELLAR_RPC_URL`            | `http://localhost:8000/soroban/rpc`  |
| `STELLAR_NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` |
| `USDC_SAC_ID`                | Deploy a test USDC SAC (see above)   |
| `TREASURY_ADDRESS`           | Any funded local address             |
| `AUDIT_FUND_ADDRESS`         | Any funded local address             |

## Running tests against local node

The Soroban testutils environment (`Env::default()` in `cargo test`) is fully
self-contained and does **not** require a running node. All `cargo test` runs
are in-process and do not touch the network.

To run integration tests against a live local node:

```bash
# After deploying with --network local:
STELLAR_NETWORK=local pnpm demo:e2e
```

## Checking the deployment

```bash
# Verify a deployed contract responds
stellar contract invoke \
  --id $REGISTRY_ID \
  --network local \
  --source deployer \
  -- version

# Should output: 1
```

## Resetting the local network

```bash
stellar network stop local   # or Ctrl-C the foreground process
stellar network start local  # fresh state
# Re-deploy from scratch (deploy-testnet.sh is idempotent for IDs already in .env.local;
# delete .env.local first for a clean re-deploy)
rm -f .env.local
./scripts/deploy-testnet.sh --network local
```
