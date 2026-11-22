import path from 'node:path';

/**
 * Single source of truth for where elimuNest keeps its runtime data and
 * whether the bundled sample schools get loaded.
 *
 * Data layout
 * -----------
 *  - SAMPLE DATA  (committed to git)   server/seed.ts — Oakridge, Westfield and
 *                                       St Jude, with students, fees, exams, etc.
 *  - RUNTIME DATA (never committed)    <DATA_DIR>/elimunest-db.json
 *  - BACKUPS      (never committed)    <DATA_DIR>/backups/  (daily, rotated)
 *  - EXPORTS      (never committed)    <DATA_DIR>/exports/  (manual, `npm run data:export`)
 *
 * Sample data is only ever loaded when there is no database yet, so it can
 * never overwrite real data. To load it on demand see `npm run data:reset-sample`.
 */

// Set DATA_DIR to a persistent disk path in production (e.g. /var/data on Render).
// On Vercel the filesystem is read-only except /tmp, which is per-instance and
// temporary unless backed by KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL
  ? '/tmp/elimunest-data'
  : path.resolve(process.cwd(), 'data');

export const DB_FILE = path.join(DATA_DIR, 'elimunest-db.json');
export const LEGACY_DB_FILE = path.join(DATA_DIR, 'scholara-db.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');

/** How many daily backups to keep before the oldest are pruned. */
export const DAILY_BACKUPS_TO_KEEP = 7;

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

/**
 * Should a brand-new (empty) deployment be filled with the sample schools?
 *
 *  - Tests: never (they build their own fixtures).
 *  - SEED_DEMO_DATA=true|1  : yes, in any environment, including production.
 *  - SEED_DEMO_DATA=false|0 : no, in any environment.
 *  - Unset                  : yes in development, no in production.
 */
export function shouldSeedDemoData(): boolean {
  if (isTestEnvironment()) return false;
  const flag = process.env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}
