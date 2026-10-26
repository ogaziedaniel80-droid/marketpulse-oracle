#!/usr/bin/env node
/**
 * scripts/bindings-generate.js
 *
 * Generates TypeScript contract bindings for all MarketPulse Oracle contracts
 * using `stellar contract bindings typescript` (Stellar CLI 28.0.0).
 *
 * Usage:
 *   node scripts/bindings-generate.js
 *   # or via pnpm: pnpm bindings:generate
 *
 * Requires:
 *   - .env.local with CONTRACT_IDs (written by deploy-testnet.sh)
 *   - stellar CLI in PATH
 *   - STELLAR_NETWORK env var (defaults to testnet)
 *
 * Per README section 14.6.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Load .env.local (never print secrets)
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env.local not found. Run scripts/deploy-testnet.sh first.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

// ---------------------------------------------------------------------------
// Contract definitions: name → { envKey, outputDir }
// ---------------------------------------------------------------------------
const CONTRACTS = [
  {
    name: 'registry',
    envKey: 'REGISTRY_ID',
    outputDir: 'packages/bindings/registry',
  },
  {
    name: 'request-board',
    envKey: 'REQUEST_BOARD_ID',
    outputDir: 'packages/bindings/request-board',
  },
  {
    name: 'report-engine',
    envKey: 'REPORT_ENGINE_ID',
    outputDir: 'packages/bindings/report-engine',
  },
  {
    name: 'disputes',
    envKey: 'DISPUTES_ID',
    outputDir: 'packages/bindings/disputes',
  },
  {
    name: 'oracle-feed',
    envKey: 'ORACLE_FEED_ID',
    outputDir: 'packages/bindings/oracle-feed',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const localEnv = loadEnvLocal();
  const network = process.env.STELLAR_NETWORK || localEnv['STELLAR_NETWORK'] || 'testnet';

  console.log(`Generating TypeScript bindings (network: ${network})`);
  console.log('');

  let allOk = true;

  for (const contract of CONTRACTS) {
    const contractId = localEnv[contract.envKey];
    if (!contractId) {
      console.warn(
        `  [SKIP] ${contract.name}: ${contract.envKey} not set in .env.local`
      );
      allOk = false;
      continue;
    }

    const outDir = path.join(__dirname, '..', contract.outputDir);
    fs.mkdirSync(outDir, { recursive: true });

    const cmd = [
      'stellar contract bindings typescript',
      `--network ${network}`,
      `--contract-id ${contractId}`,
      `--output-dir ${outDir}`,
    ].join(' \\\n  ');

    console.log(`  Generating: ${contract.name}`);
    console.log(`    contract-id : ${contractId}`);
    console.log(`    output-dir  : ${contract.outputDir}`);

    try {
      execSync(cmd, { stdio: 'inherit' });
      console.log(`  [OK] ${contract.name}`);
    } catch (err) {
      console.error(`  [FAIL] ${contract.name}: ${err.message}`);
      allOk = false;
    }
    console.log('');
  }

  if (allOk) {
    console.log('All bindings generated successfully.');
    console.log('Run `pnpm typecheck` to verify TypeScript types.');
  } else {
    console.warn('Some bindings were skipped or failed. Check .env.local for missing IDs.');
    console.warn('Deploy contracts first: ./scripts/deploy-testnet.sh');
    process.exit(1);
  }
}

main();
