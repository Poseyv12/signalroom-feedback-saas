import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function assertHealthyDatabase(path: string) {
  const db = new DatabaseSync(path);
  try {
    const result = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (Object.values(result)[0] !== 'ok') throw new Error(`Database integrity check failed for ${path}.`);
  } finally {
    db.close();
  }
}

export function backupDatabase(sourcePath: string, backupPath: string) {
  if (!existsSync(sourcePath)) throw new Error(`Source database does not exist: ${sourcePath}`);
  if (existsSync(backupPath)) throw new Error(`Backup target already exists: ${backupPath}`);
  mkdirSync(dirname(backupPath), { recursive: true });

  const db = new DatabaseSync(sourcePath);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA wal_checkpoint(FULL);');
    db.prepare('VACUUM INTO ?').run(backupPath);
  } finally {
    db.close();
  }
  assertHealthyDatabase(backupPath);
}

export function restoreDatabase(backupPath: string, targetPath: string, options: { force?: boolean } = {}) {
  if (!existsSync(backupPath)) throw new Error(`Backup database does not exist: ${backupPath}`);
  if (existsSync(targetPath) && !options.force) throw new Error(`Restore target already exists: ${targetPath}`);
  assertHealthyDatabase(backupPath);

  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.restore-${process.pid}`;
  rmSync(temporaryPath, { force: true });
  copyFileSync(backupPath, temporaryPath);
  assertHealthyDatabase(temporaryPath);

  if (options.force) {
    rmSync(targetPath, { force: true });
    rmSync(`${targetPath}-wal`, { force: true });
    rmSync(`${targetPath}-shm`, { force: true });
  }
  renameSync(temporaryPath, targetPath);
}
