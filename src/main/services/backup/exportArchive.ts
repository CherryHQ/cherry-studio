import { mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'

import { publishArchive } from './archivePublish'
import { presentDegradations } from './degradationReport'
import { assertDiskHeadroom } from './diskPreflight'
import { BackupCancelledError } from './errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest, type ManagedRootIdentity } from './manifest'
import { currentBackupPlatform } from './platform'
import { REBASABLE_MANAGED_ROOT_KEYS } from './portability/managedPathRebase'
import {
  type MaterializationSummary,
  materializePortableDatabase,
  summarizeMaterializationDegradations
} from './portability/materializeDatabase'

const logger = loggerService.withContext('backupExport')
const STAGED_DB_NAME = 'backup.sqlite'

export interface ExportArchiveInputs {
  /** Destination `.cherrybackup` path. It must not already exist. */
  readonly outPath: string
  readonly signal?: AbortSignal
}

export interface ExportArchiveResult {
  readonly outPath: string
  readonly manifest: BackupManifest
  readonly summary: MaterializationSummary
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
}

function producerManagedRoots(): ManagedRootIdentity[] {
  return REBASABLE_MANAGED_ROOT_KEYS.map((key) => ({ key, path: application.getPath(key) }))
}

function readSealedChain(dbPath: string): ReturnType<typeof readAppliedChain> {
  const sqlite = new Database(dbPath, { fileMustExist: true, readonly: true })
  try {
    return readAppliedChain(sqlite)
  } finally {
    sqlite.close()
  }
}

/** Create a sealed, portable whole-database Lite archive. */
export async function exportArchive(inputs: ExportArchiveInputs): Promise<ExportArchiveResult> {
  const { outPath, signal } = inputs
  throwIfAborted(signal)
  const stagingRoot = await mkdtemp(path.join(application.getPath('feature.backup.temp'), 'export-'))
  try {
    const stagedDbPath = path.join(stagingRoot, STAGED_DB_NAME)
    const liveDbBytes = (await stat(application.getPath('app.database.file'))).size
    await assertDiskHeadroom({ target: stagingRoot, neededBytes: liveDbBytes })

    application.get('DbService').createSnapshot(stagedDbPath)
    throwIfAborted(signal)
    const materialized = await materializePortableDatabase({ dbPath: stagedDbPath, mode: { kind: 'export' }, signal })
    throwIfAborted(signal)

    const manifest: BackupManifest = {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      preset: 'lite',
      createdAt: new Date().toISOString(),
      producer: { platform: currentBackupPlatform(), managedRoots: producerManagedRoots() },
      migrationChain: readSealedChain(stagedDbPath),
      db: { hash: materialized.hash, sizeBytes: materialized.sizeBytes },
      degradations: presentDegradations(
        summarizeMaterializationDegradations(materialized.summary.degradations, 'portable-db')
      )
    }

    await assertDiskHeadroom({ target: outPath, neededBytes: materialized.sizeBytes })
    await publishArchive({ outPath, manifest, dbCopyPath: stagedDbPath, signal })
    logger.info('Lite archive exported', {
      dbSizeBytes: materialized.sizeBytes,
      degradations: manifest.degradations
    })
    return { outPath, manifest, summary: materialized.summary }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
