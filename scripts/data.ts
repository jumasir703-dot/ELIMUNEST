// elimuNest data tooling. Run with:  npm run data -- <command>
//
//   status                 Show where the database lives, what is in it, and the backups.
//   export [file]          Write a full copy of the database (default: <DATA_DIR>/exports/).
//   import <file> --yes    Replace the database with an export or backup file.
//   reset-sample --yes     Replace the database with the bundled sample schools (server/seed.ts).
//
// import / reset-sample first save the current database to <DATA_DIR>/backups/
// as elimunest-db.pre-<label>.<timestamp>.json, which is never pruned.
// STOP THE SERVER before import / reset-sample, otherwise it will overwrite the
// result on its next save.
import '../server/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, DATA_DIR, DB_FILE, EXPORT_DIR } from '../server/dataConfig.ts';
import { snapshotBeforeChange } from '../server/lib/dbBackup.ts';
import { createSeedDatabase, type DatabaseState } from '../server/seed.ts';

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readState(file: string): DatabaseState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    fail(`Could not read ${file}: ${(err as Error).message}`);
  }
  // Accept both a raw database file and the { exportedAt, state } wrapper used by the dev panel.
  const candidate =
    parsed && typeof parsed === 'object' && 'state' in (parsed as object)
      ? (parsed as { state: unknown }).state
      : parsed;
  const state = candidate as DatabaseState;
  if (!state || !Array.isArray(state.tenants) || state.tenants.length === 0) {
    fail(`${file} is not a valid elimuNest database (expected a non-empty "tenants" array).`);
  }
  return state;
}

function writeDatabase(state: DatabaseState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function summarize(state: DatabaseState): string {
  return `${state.tenants.length} schools, ${(state.users || []).length} users, ${state.students.length} students`;
}

function status() {
  console.log(`Data directory : ${DATA_DIR}`);
  if (fs.existsSync(DB_FILE)) {
    const size = (fs.statSync(DB_FILE).size / 1024).toFixed(0);
    let contents = 'unreadable';
    try {
      contents = summarize(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as DatabaseState);
    } catch {
      // leave as unreadable
    }
    console.log(`Database       : ${DB_FILE} (${size} KB) — ${contents}`);
  } else {
    console.log(`Database       : none yet (${DB_FILE}). It is created on first start.`);
  }
  for (const [label, dir] of [['Backups', BACKUP_DIR], ['Exports', EXPORT_DIR]] as const) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    console.log(`${label.padEnd(15)}: ${files.length === 0 ? 'none' : ''}`);
    for (const f of files) console.log(`    ${path.join(dir, f)}`);
  }
}

function exportDb(target?: string) {
  if (!fs.existsSync(DB_FILE)) fail(`No database to export at ${DB_FILE}.`);
  const state = readState(DB_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = target ? path.resolve(target) : path.join(EXPORT_DIR, `elimunest-export-${stamp}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2), 'utf-8');
  console.log(`✔ Exported ${summarize(state)} to ${file}`);
  console.log('  This file contains password hashes — keep it out of git.');
}

function importDb(file: string | undefined, confirmed: boolean) {
  if (!file) fail('Usage: npm run data -- import <file> --yes');
  const state = readState(path.resolve(file));
  if (!confirmed) fail(`This replaces the current database with ${summarize(state)}. Re-run with --yes to confirm.`);
  const saved = snapshotBeforeChange(DB_FILE, BACKUP_DIR, 'import');
  writeDatabase(state);
  console.log(`✔ Imported ${summarize(state)}.`);
  if (saved) console.log(`  Previous database saved to ${saved}`);
}

async function resetSample(confirmed: boolean) {
  const { state, devCredentials } = await createSeedDatabase({ empty: false });
  if (!confirmed) {
    fail(`This replaces the current database with the sample schools (${summarize(state)}). Re-run with --yes to confirm.`);
  }
  const saved = snapshotBeforeChange(DB_FILE, BACKUP_DIR, 'reset-sample');
  writeDatabase(state);
  console.log(`✔ Loaded sample schools: ${summarize(state)}.`);
  if (saved) console.log(`  Previous database saved to ${saved}`);
  console.log('\nOne-time passwords (change required on first login):');
  for (const cred of devCredentials) {
    console.log(`  - ${cred.role.padEnd(11)} | ${cred.email} | ${cred.password}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
const confirmed = rest.includes('--yes');
const positional = rest.filter((arg) => !arg.startsWith('--'));

switch (command) {
  case 'status':
    status();
    break;
  case 'export':
    exportDb(positional[0]);
    break;
  case 'import':
    importDb(positional[0], confirmed);
    break;
  case 'reset-sample':
    await resetSample(confirmed);
    break;
  default:
    console.log('Usage: npm run data -- <status | export [file] | import <file> --yes | reset-sample --yes>');
    process.exit(command ? 1 : 0);
}
