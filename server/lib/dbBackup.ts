import fs from 'node:fs';
import path from 'node:path';

const DAILY_PATTERN = /^elimunest-db\.\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Copies the database file into `backupDir` once per calendar day (UTC) and
 * prunes the oldest daily copies beyond `keep`. Never throws: a failed backup
 * must not stop the server from starting.
 *
 * Returns the backup path when one exists for today, otherwise null.
 */
export function rotateDailyBackup(dbFile: string, backupDir: string, keep = 7): string | null {
  try {
    if (!fs.existsSync(dbFile)) return null;
    fs.mkdirSync(backupDir, { recursive: true });

    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir, `elimunest-db.${day}.json`);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(dbFile, target);
    }

    const daily = fs
      .readdirSync(backupDir)
      .filter((name) => DAILY_PATTERN.test(name))
      .sort();
    for (const stale of daily.slice(0, Math.max(0, daily.length - keep))) {
      fs.rmSync(path.join(backupDir, stale), { force: true });
    }
    return target;
  } catch (err) {
    console.warn('[elimuNest] Daily database backup skipped:', err);
    return null;
  }
}

/**
 * Takes a one-off, timestamped copy of the database before something
 * destructive (import, reset). These are never pruned automatically.
 */
export function snapshotBeforeChange(dbFile: string, backupDir: string, label: string): string | null {
  if (!fs.existsSync(dbFile)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `elimunest-db.pre-${label}.${stamp}.json`);
  fs.copyFileSync(dbFile, target);
  return target;
}
