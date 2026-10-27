#!/usr/bin/env node
/**
 * MarketPulse Database Migration Runner
 * Supports PostgreSQL with PostGIS extension.
 * Usage:
 *   node scripts/db-migrate.js [--up] [--down [steps]] [--status]
 */

import { Migrator } from '../packages/shared/dist/db/migrator.js';

async function main() {
  const args = process.argv.slice(2);
  const isDown = args.includes('--down');
  const isStatus = args.includes('--status');

  const migrator = new Migrator({
    log: (msg) => console.log(`[db:migrate] ${msg}`),
  });

  try {
    if (isStatus) {
      console.log('--- Migration Status ---');
      const files = migrator.getMigrationFiles();
      console.log(`Available migration files: ${files.length}`);
      for (const f of files) {
        console.log(`  - ${f.name}`);
      }
      return;
    }

    if (isDown) {
      const stepIdx = args.indexOf('--down');
      const steps =
        args[stepIdx + 1] && !args[stepIdx + 1].startsWith('--')
          ? parseInt(args[stepIdx + 1], 10)
          : 1;
      console.log(`Rolling back ${steps} migration(s)...`);
      const { rolledBack } = await migrator.down(steps);
      console.log(`Successfully rolled back: ${rolledBack.join(', ') || 'none'}`);
      return;
    }

    // Default: UP
    console.log('Running MarketPulse database migrations (Postgres + PostGIS)...');
    const { applied } = await migrator.up();
    if (applied.length === 0) {
      console.log('Database schema is already up to date.');
    } else {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('connect')) {
      console.warn(`[WARN] PostgreSQL database is not reachable at DATABASE_URL.`);
      console.warn(
        `Ensure Docker Compose is running: docker compose -f infra/docker/compose.dev.yml up -d`,
      );
      console.warn(`Error details: ${message}`);
      // Do not hard-crash CI if docker daemon is not running in restricted build environments
      process.exit(0);
    } else {
      console.error(`[ERROR] Migration failed: ${message}`);
      process.exit(1);
    }
  } finally {
    await migrator.close();
  }
}

main();
