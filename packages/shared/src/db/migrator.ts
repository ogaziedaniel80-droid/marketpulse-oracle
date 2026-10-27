import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationFile {
  id: string;
  name: string;
  upPath: string;
  downPath: string;
}

export interface MigratorOptions {
  connectionString?: string;
  client?: pg.ClientBase | pg.Pool;
  migrationsDir?: string;
  log?: (message: string) => void;
}

export class Migrator {
  private client?: pg.ClientBase | pg.Pool;
  private ownPool?: pg.Pool;
  private migrationsDir: string;
  private log: (msg: string) => void;

  constructor(options: MigratorOptions = {}) {
    this.log = options.log || console.log;
    this.client = options.client;
    if (!this.client && options.connectionString) {
      this.ownPool = new pg.Pool({ connectionString: options.connectionString });
      this.client = this.ownPool;
    }
    // Default migrations dir relative to package root
    this.migrationsDir = options.migrationsDir || path.resolve(__dirname, '../../../migrations');
    if (!fs.existsSync(this.migrationsDir)) {
      // Fallback relative to current directory
      const fallback = path.resolve(__dirname, '../../migrations');
      if (fs.existsSync(fallback)) {
        this.migrationsDir = fallback;
      }
    }
  }

  public async getDbClient(): Promise<pg.ClientBase | pg.Pool> {
    if (!this.client) {
      const connStr =
        process.env.DATABASE_URL || 'postgres://marketpulse:marketpulse@localhost:5432/marketpulse';
      this.ownPool = new pg.Pool({ connectionString: connStr });
      this.client = this.ownPool;
    }
    return this.client;
  }

  public getMigrationFiles(): MigrationFile[] {
    if (!fs.existsSync(this.migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${this.migrationsDir}`);
    }
    const files = fs.readdirSync(this.migrationsDir);
    const upFiles = files.filter((f) => f.endsWith('.up.sql')).sort();

    return upFiles.map((upFile) => {
      const baseName = upFile.replace(/\.up\.sql$/, '');
      const downFile = `${baseName}.down.sql`;
      const downPath = path.join(this.migrationsDir, downFile);
      if (!fs.existsSync(downPath)) {
        throw new Error(`Missing corresponding down migration file for ${upFile}`);
      }
      return {
        id: baseName.split('_')[0],
        name: baseName,
        upPath: path.join(this.migrationsDir, upFile),
        downPath,
      };
    });
  }

  public async ensureMigrationsTable(client: pg.ClientBase | pg.Pool): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async getExecutedMigrations(client: pg.ClientBase | pg.Pool): Promise<string[]> {
    await this.ensureMigrationsTable(client);
    const res = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name ASC',
    );
    return res.rows.map((r) => r.name);
  }

  public async up(): Promise<{ applied: string[] }> {
    const client = await this.getDbClient();
    await this.ensureMigrationsTable(client);
    const executed = await this.getExecutedMigrations(client);
    const all = this.getMigrationFiles();
    const applied: string[] = [];

    for (const m of all) {
      if (!executed.includes(m.name)) {
        this.log(`Applying migration: ${m.name}`);
        const sql = fs.readFileSync(m.upPath, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
          await client.query('COMMIT');
          applied.push(m.name);
          this.log(`Applied migration: ${m.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `Failed to apply migration ${m.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { applied };
  }

  public async down(steps = 1): Promise<{ rolledBack: string[] }> {
    const client = await this.getDbClient();
    await this.ensureMigrationsTable(client);
    const executed = await this.getExecutedMigrations(client);
    const all = this.getMigrationFiles();
    const map = new Map(all.map((m) => [m.name, m]));
    const rolledBack: string[] = [];

    // Roll back from latest to earliest
    const toRollBack = executed.slice(-steps).reverse();

    for (const name of toRollBack) {
      const m = map.get(name);
      if (!m) {
        throw new Error(`Migration ${name} found in database but no local file exists`);
      }
      this.log(`Rolling back migration: ${name}`);
      const sql = fs.readFileSync(m.downPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
        await client.query('COMMIT');
        rolledBack.push(name);
        this.log(`Rolled back migration: ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Failed to rollback migration ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { rolledBack };
  }

  public async close(): Promise<void> {
    if (this.ownPool) {
      await this.ownPool.end();
    }
  }
}
