import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import { Migrator } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database Schema & Migrations', () => {
  const migrationsDir = path.resolve(__dirname, '../migrations');

  test('all required migration files exist and have pairs', () => {
    const migrator = new Migrator({ migrationsDir });
    const files = migrator.getMigrationFiles();
    assert.ok(files.length >= 2, 'should have at least 2 migrations');

    for (const file of files) {
      assert.ok(fs.existsSync(file.upPath), `up path exists for ${file.name}`);
      assert.ok(fs.existsSync(file.downPath), `down path exists for ${file.name}`);
    }
  });

  test('001_initial_schema contains all 15 required tables with guardrails', () => {
    const upSql = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.up.sql'), 'utf8');

    const requiredTables = [
      'reporters',
      'devices',
      'vouches',
      'requests',
      'reports',
      'observations',
      'evidence',
      'flags',
      'audits',
      'payouts',
      'markets',
      'api_keys',
      'webhooks',
      'event_cursor',
      'admin_actions',
    ];

    for (const table of requiredTables) {
      assert.match(
        upSql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'),
        `Migration 001 must create table ${table}`,
      );
    }

    // Privacy guardrail: phone numbers must never be plain text
    assert.match(upSql, /phone_hash/i, 'reporters table must store phone_hash');
    assert.match(upSql, /phone_salt/i, 'reporters table must store phone_salt');
    assert.doesNotMatch(
      upSql,
      /phone_number\s+varchar/i,
      'reporters table must not store raw phone_number',
    );

    // Buyer query pattern index
    assert.match(
      upSql,
      /idx_observations_buyer_query/i,
      'observations must have index for buyer query pattern',
    );
    assert.match(
      upSql,
      /geohash\s+text_pattern_ops/i,
      'observations buyer index must support prefix queries via text_pattern_ops',
    );

    // Retention policy comments
    assert.match(
      upSql,
      /COMMENT ON TABLE reporters/i,
      'reporters table must have retention comment',
    );
    assert.match(upSql, /COMMENT ON TABLE evidence/i, 'evidence table must have retention comment');
    assert.match(
      upSql,
      /COMMENT ON TABLE admin_actions/i,
      'admin_actions table must have retention comment',
    );
  });

  test('001_initial_schema down migration drops all created tables', () => {
    const downSql = fs.readFileSync(
      path.join(migrationsDir, '001_initial_schema.down.sql'),
      'utf8',
    );

    const requiredTables = [
      'admin_actions',
      'event_cursor',
      'webhooks',
      'api_keys',
      'payouts',
      'audits',
      'flags',
      'evidence',
      'observations',
      'reports',
      'requests',
      'vouches',
      'devices',
      'reporters',
      'markets',
    ];

    for (const table of requiredTables) {
      assert.match(
        downSql,
        new RegExp(`DROP TABLE IF EXISTS ${table}`, 'i'),
        `Down migration must drop table ${table}`,
      );
    }
  });

  test('in-memory pg-mem migration execution up and down', async () => {
    const db = newDb({ noAstCoverageCheck: true });

    // Register mocks for PostGIS and extensions in pg-mem
    db.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: db.public.getType('text'),
      implementation: () => '11111111-1111-1111-1111-111111111111',
    });

    db.public.registerFunction({
      name: 'st_makepoint',
      args: [db.public.getType('float'), db.public.getType('float')],
      returns: db.public.getType('text'),
      implementation: (x: number, y: number) => `POINT(${x} ${y})`,
    });

    db.public.registerFunction({
      name: 'st_setsrid',
      args: [db.public.getType('text'), db.public.getType('integer')],
      returns: db.public.getType('text'),
      implementation: (pt: string) => pt,
    });

    const pgAdapter = db.adapters.createPg();
    const client = new pgAdapter.Pool();

    // Intercept CREATE EXTENSION and GEOGRAPHY type for pg-mem compatibility
    const origQuery = client.query.bind(client);
    client.query = async (queryTextOrConfig: any, values?: any) => {
      let sql = typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
      // Strip CREATE EXTENSION for pg-mem
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, '-- skipped extension');
      // Replace GEOGRAPHY(...) with TEXT for pg-mem
      sql = sql.replace(/GEOGRAPHY\([^)]+\)/gi, 'TEXT');
      // Replace ::geography cast with ::text
      sql = sql.replace(/::geography/gi, '::text');
      // Replace USING GIST (location) with (location)
      sql = sql.replace(/USING GIST\s*\(([^)]+)\)/gi, '($1)');
      // Replace text_pattern_ops
      sql = sql.replace(/text_pattern_ops/gi, '');
      // Replace COMMENT ON
      sql = sql.replace(/COMMENT ON [^;]+;/gi, '-- skipped comment');

      if (typeof queryTextOrConfig === 'object') {
        queryTextOrConfig.text = sql;
        return origQuery(queryTextOrConfig);
      }
      return origQuery(sql, values);
    };

    const migrator = new Migrator({
      client,
      migrationsDir,
      log: () => {},
    });

    // Run up migrations
    const { applied } = await migrator.up();
    assert.equal(applied.length, 2, 'should apply 2 migrations');

    // Verify tables exist in pg-mem
    const marketsRes = await client.query('SELECT COUNT(*) FROM markets');
    assert.equal(parseInt(marketsRes.rows[0].count, 10), 4, 'should have 4 seeded markets');

    // Run down migration for migration 002
    const { rolledBack: rb1 } = await migrator.down(1);
    assert.deepEqual(rb1, ['002_seed_initial_markets']);

    const marketsAfterDown = await client.query('SELECT COUNT(*) FROM markets');
    assert.equal(
      parseInt(marketsAfterDown.rows[0].count, 10),
      0,
      'seeded markets should be deleted',
    );

    // Run down migration for migration 001
    const { rolledBack: rb2 } = await migrator.down(1);
    assert.deepEqual(rb2, ['001_initial_schema']);
  });
});
