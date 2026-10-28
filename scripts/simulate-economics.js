#!/usr/bin/env node
/**
 * Economic simulation runner per README Section 10 & 16.
 * Invokes the agent-based Monte-Carlo simulation model in simulations/agent_simulation.py
 * and writes docs/economic-simulation.md.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const simScript = path.join(repoRoot, 'simulations', 'agent_simulation.py');

console.log('Running MarketPulse Oracle economic simulation engine...');
const result = spawnSync('python3', [simScript], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  console.error(`Economic simulation failed with exit code ${result.status}`);
  process.exit(result.status || 1);
}

console.log('Economic simulation completed successfully.');
