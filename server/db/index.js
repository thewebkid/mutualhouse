import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { INITIAL_MIGRATION_SQL } from './schema-sql.js';

const { Pool } = pg;

let _dbAdapter = null;
let _initPromise = null;

/**
 * Unified PostgreSQL transactional query adapter supporting:
 *  1. Neon Serverless Postgres / standard Postgres (`DATABASE_URL` or `POSTGRES_URL`)
 *  2. Embedded PGlite Postgres 16 (`memory://` in tests or `./.data/pglite` in local dev)
 *
 * Interface:
 *  - `await db.query(sqlText, params)` -> `{ rows }`
 *  - `await db.transaction(async (tx) => { ... })` -> runs inside `BEGIN` / `COMMIT` / `ROLLBACK`
 */
function createPoolAdapter(connectionString) {
  const pool = new Pool({
    connectionString,
    max: 10,
  });

  return {
    driver: 'pg',
    pool,
    async query(text, params = []) {
      const res = await pool.query(text, params);
      return { rows: res.rows ?? [], rowCount: res.rowCount ?? 0 };
    },
    async exec(sqlScript) {
      await pool.query(sqlScript);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          async query(text, params = []) {
            const res = await client.query(text, params);
            return { rows: res.rows ?? [], rowCount: res.rowCount ?? 0 };
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function createPgliteAdapter(dataDir) {
  const pglite = dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir);
  // Serialize transactions on single-instance PGlite to prevent interleaved BEGIN/COMMIT
  let txQueue = Promise.resolve();

  return {
    driver: 'pglite',
    pglite,
    async query(text, params = []) {
      const res = await pglite.query(text, params);
      return { rows: res.rows ?? [], rowCount: res.affectedRows ?? res.rows?.length ?? 0 };
    },
    async exec(sqlScript) {
      await pglite.exec(sqlScript);
    },
    transaction(fn) {
      const run = txQueue.then(async () => {
        return pglite.transaction(async (pgTx) => {
          const tx = {
            async query(text, params = []) {
              const res = await pgTx.query(text, params);
              return {
                rows: res.rows ?? [],
                rowCount: res.affectedRows ?? res.rows?.length ?? 0,
              };
            },
          };
          return fn(tx);
        });
      });
      txQueue = run.catch(() => {});
      return run;
    },
    async close() {
      await pglite.close();
    },
  };
}

export async function getDb() {
  if (_dbAdapter) return _dbAdapter;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
    let adapter;
    if (connStr && !connStr.startsWith('pglite://') && connStr !== 'memory://') {
      adapter = createPoolAdapter(connStr);
    } else {
      const isTest = process.env.VITEST === 'true' || connStr === 'memory://';
      if (isTest) {
        adapter = createPgliteAdapter('memory://');
      } else {
        const dataDir = path.resolve(process.cwd(), '.data', 'pglite');
        fs.mkdirSync(dataDir, { recursive: true });
        adapter = createPgliteAdapter(dataDir);
      }
    }

    await adapter.exec(INITIAL_MIGRATION_SQL);
    _dbAdapter = adapter;
    return adapter;
  })();

  return _initPromise;
}

export async function resetDbForTests() {
  if (_dbAdapter) {
    await _dbAdapter.close();
    _dbAdapter = null;
    _initPromise = null;
  }
  process.env.DATABASE_URL = 'memory://';
  return getDb();
}
