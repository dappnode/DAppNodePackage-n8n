// Keeps the files the DAppNode backup copies (manifest `backup`) and imports them after a restore.
//
// The DAppNode backup copies files out of the running container. Copying the live SQLite database
// (database.sqlite plus its -wal file, written to while it is read) can produce a corrupt copy, so this
// script keeps a consistent snapshot of it instead (VACUUM INTO), and a copy of the `config` file that
// holds the encryption key of the stored credentials.
//
//   node backup.mjs export   Refresh the snapshot and the key copy (skipped if unchanged)
//   node backup.mjs import   Before n8n starts: put back a snapshot or key copy restored from a backup
//
// The state file, which is not backed up, records the inode and ctime of the files this script last wrote
// or imported. A restore writes a new file (new inode, new ctime) even when its content is the same, so
// any restored file is imported, while files this script wrote are never imported again.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Same folder and database path n8n uses
const n8nFolder = path.join(process.env.N8N_USER_FOLDER || process.env.HOME || "/home/node", ".n8n");
const isSqlite = (process.env.DB_TYPE || "sqlite") === "sqlite";
const database = path.resolve(n8nFolder, process.env.DB_SQLITE_DATABASE || "database.sqlite");
const config = path.join(n8nFolder, "config");

// Declared in the manifest `backup`
const databaseBackup = path.join(n8nFolder, "backup-database.sqlite");
// The backup tab restores files owned by root, so the copy must stay readable for the node user
const configBackup = path.join(n8nFolder, "backup-config.json");
const stateFile = path.join(n8nFolder, ".backup-state.json");

function log(message) {
  console.log(`[backup] ${message}`);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeAtomic(stateFile, JSON.stringify(state), 0o600);
}

function writeAtomic(file, data, mode) {
  fs.writeFileSync(`${file}.tmp`, data, { mode });
  fs.chmodSync(`${file}.tmp`, mode);
  fs.renameSync(`${file}.tmp`, file);
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Identifies the file written at a path: a restore replaces it with a new inode, and always sets its ctime */
function identity(file) {
  const { ino, ctimeNs } = fs.statSync(file, { bigint: true });
  return `${ino}:${ctimeNs}`;
}

/** Whether `file` is the one this script last wrote or imported, as recorded in `entry` of the state */
function isKnown(file, entry) {
  return entry?.identity === identity(file);
}

function exportDatabase(state) {
  if (!isSqlite || !fs.existsSync(database)) return;
  if (fs.existsSync(databaseBackup) && !isKnown(databaseBackup, state.database)) {
    log(`${databaseBackup} was restored from a backup and is not imported yet, restart n8n to import it`);
    return;
  }
  const startedAt = Date.now();
  const lastChange = Math.max(mtimeMs(database), mtimeMs(`${database}-wal`));
  if (state.database && lastChange < state.database.exportedAt) return;

  const tmp = `${databaseBackup}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    const db = new DatabaseSync(database, { timeout: 60_000 });
    try {
      // A consistent copy, read in one transaction while n8n keeps writing
      db.prepare("VACUUM INTO ?").run(tmp);
    } finally {
      db.close();
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.chmodSync(tmp, 0o644);
  // A restore may have put back the file while exporting
  if (fs.existsSync(databaseBackup) && !isKnown(databaseBackup, state.database)) {
    fs.rmSync(tmp, { force: true });
    return;
  }
  fs.renameSync(tmp, databaseBackup);
  state.database = { identity: identity(databaseBackup), exportedAt: startedAt };
  writeState(state);
  log(`Database snapshot written to ${databaseBackup}`);
}

function exportConfig(state) {
  if (!fs.existsSync(config)) return;
  if (fs.existsSync(configBackup)) {
    if (!isKnown(configBackup, state.config)) {
      log(`${configBackup} was restored from a backup and is not imported yet, restart n8n to import it`);
      return;
    }
    if (fs.readFileSync(config).equals(fs.readFileSync(configBackup))) return;
  }
  writeAtomic(configBackup, fs.readFileSync(config), 0o644);
  state.config = { identity: identity(configBackup) };
  writeState(state);
  log(`Encryption key copied to ${configBackup}`);
}

/** Move a file aside, so the data replaced by a restore can still be recovered by hand */
function keepPrevious(file) {
  if (fs.existsSync(file)) fs.renameSync(file, `${file}.before-restore`);
}

/** Copy the restored snapshot next to the database and check it, without replacing anything yet */
function prepareDatabase() {
  const tmp = `${database}.restore-tmp`;
  fs.copyFileSync(databaseBackup, tmp);
  fs.chmodSync(tmp, 0o644);
  try {
    const db = new DatabaseSync(tmp);
    try {
      const result = db.prepare("PRAGMA integrity_check").all();
      if (result.length !== 1 || Object.values(result[0])[0] !== "ok") {
        throw Error(`${databaseBackup} failed the integrity check: ${JSON.stringify(result)}`);
      }
    } finally {
      db.close();
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return tmp;
}

function importBackup(state) {
  const newConfig = fs.existsSync(configBackup) && !isKnown(configBackup, state.config);
  let newDatabase = fs.existsSync(databaseBackup) && !isKnown(databaseBackup, state.database);
  if (newDatabase && !isSqlite) {
    log(`WARNING: ${databaseBackup} was restored from a backup, but DB_TYPE is not sqlite, not importing it`);
    newDatabase = false;
  }
  if (!newConfig && !newDatabase) return;

  // Check everything before replacing anything, so the key and the database are never left mismatched
  let configContent;
  if (newConfig) {
    configContent = fs.readFileSync(configBackup);
    if (!JSON.parse(configContent.toString("utf8")).encryptionKey) throw Error(`${configBackup} has no encryptionKey`);
  }
  const restoredDatabase = newDatabase ? prepareDatabase() : null;

  if (newConfig) {
    log(`Importing the encryption key restored from a backup (${configBackup})`);
    keepPrevious(config);
    writeAtomic(config, configContent, 0o600);
    state.config = { identity: identity(configBackup) };
    writeState(state);
  }
  if (newDatabase) {
    log(`Importing the database restored from a backup (${databaseBackup})`);
    // The -wal file belongs to the replaced database and must never be applied to the restored one
    for (const suffix of ["", "-wal", "-journal"]) keepPrevious(`${database}${suffix}`);
    fs.rmSync(`${database}-shm`, { force: true });
    fs.renameSync(restoredDatabase, database);
    // Export again on the next run, so the snapshot follows the database from now on
    state.database = { identity: identity(databaseBackup), exportedAt: 0 };
    writeState(state);
  }
}

const command = process.argv[2];
const state = readState();
try {
  if (command === "export") {
    exportConfig(state);
    exportDatabase(state);
  } else if (command === "import") {
    importBackup(state);
  } else {
    throw Error(`Unknown command "${command}", expected export or import`);
  }
} catch (e) {
  log(`ERROR: ${command} failed: ${e.message}`);
  if (command === "import") {
    log(`n8n does not start with a partly restored backup. Fix the error above, or delete ${databaseBackup} and ${configBackup} to start with the current data`);
  }
  process.exit(1);
}
