import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import {
  clearRestoreJournal,
  dbAsideRelPath,
  readRestoreJournal,
  stagedDbRelPath,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'

import { admitArchive } from './admission/admitArchive'
import { BackupCancelledError } from './errors'
import { currentBackupPlatform } from './platform'
import { type ManagedRootRebaseTable, prepareManagedRootRebase } from './portability/managedPathRebase'
import { materializePortableDatabase, summarizeMaterializationDegradations } from './portability/materializeDatabase'
import { durabilizeRestoreStaging } from './stagingDurability'

const logger = loggerService.withContext('backupPrepareRestore')

export interface PrepareRestoreInputs {
  readonly archivePath: string
  readonly signal?: AbortSignal
}

export interface RestorePreview {
  readonly restoreId: string
  readonly degradations: readonly { readonly kind: string; readonly reason: string }[]
  readonly migratedForward: boolean
}

function buildRebaseTable(producer: {
  platform: 'darwin' | 'win32' | 'linux'
  managedRoots: readonly { key: string; path: string }[]
}): ManagedRootRebaseTable {
  const prepared = prepareManagedRootRebase({
    producerPlatform: producer.platform,
    producerRoots: producer.managedRoots,
    targetPlatform: currentBackupPlatform(),
    targetRoots: {
      'feature.notes.data': application.getPath('feature.notes.data'),
      'feature.agents.system_workspaces': application.getPath('feature.agents.system_workspaces')
    }
  })
  if (!prepared.ok) throw new Error(`restore preparation cannot rebase managed roots: ${prepared.error.code}`)
  return prepared.table
}

function removeStagedRestore(restoreId: string): void {
  fs.rmSync(path.join(application.getPath('feature.backup.restore.staging'), restoreId), {
    recursive: true,
    force: true
  })
}

function clearWayForPreparation(): void {
  const read = readRestoreJournal()
  if (read.kind === 'none') return
  if (read.kind === 'corrupt') throw new Error('restore journal is unreadable and requires explicit repair')
  if (read.journal.state === 'prepared') {
    cancelPreparedRestore()
    return
  }
  throw new Error(`a restore in state '${read.journal.state}' must be finished before another can be prepared`)
}

/** Admit and materialize an archive without modifying the live database. */
export async function prepareRestore(inputs: PrepareRestoreInputs): Promise<RestorePreview> {
  clearWayForPreparation()
  if (inputs.signal?.aborted) throw new BackupCancelledError()

  const admitted = await admitArchive({
    archivePath: inputs.archivePath,
    stagingParent: application.getPath('feature.backup.restore.staging'),
    migrationsFolder: application.getPath('app.database.migrations'),
    signal: inputs.signal
  })
  const restoreId = randomUUID()
  let staged = false
  let journalWritten = false
  try {
    const materialized = await materializePortableDatabase({
      dbPath: admitted.db.path,
      mode: { kind: 'restore', rebase: buildRebaseTable(admitted.manifest.producer) },
      signal: inputs.signal
    })
    const userData = application.getPath('app.userdata')
    const stagedPath = path.resolve(userData, stagedDbRelPath(restoreId))
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true })
    fs.renameSync(admitted.db.path, stagedPath)
    staged = true
    durabilizeRestoreStaging(path.dirname(stagedPath))

    const degradations = summarizeMaterializationDegradations(materialized.summary.degradations, 'restore-db')
    writeRestoreJournal({
      version: 2,
      restoreId,
      createdAt: new Date().toISOString(),
      state: 'prepared',
      db: {
        promote: stagedDbRelPath(restoreId),
        aside: dbAsideRelPath(restoreId),
        chain: materialized.chain.map(({ folderMillis, hash }) => ({ folderMillis, hash }))
      },
      ...(degradations.length > 0 ? { degradations } : {})
    })
    journalWritten = true
    await admitted
      .cleanup()
      .catch((error) => logger.warn('Could not remove admission staging after preparation', error))
    return { restoreId, degradations, migratedForward: admitted.migratedForward }
  } catch (error) {
    if (staged && !journalWritten) removeStagedRestore(restoreId)
    if (!journalWritten) await admitted.cleanup().catch(() => {})
    throw error
  }
}

/** Cancels only an unconfirmed preparation; staging disappears before its journal. */
export function cancelPreparedRestore(): void {
  const read = readRestoreJournal()
  if (read.kind === 'none') return
  if (read.kind !== 'ok' || read.journal.state !== 'prepared') {
    throw new Error('only a prepared restore can be cancelled')
  }
  removeStagedRestore(read.journal.restoreId)
  clearRestoreJournal()
}

/** Arms precisely the previewed restore before initiating the preboot relaunch. */
export function armPreparedRestore(expectedRestoreId: string): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok' || read.journal.state !== 'prepared' || read.journal.restoreId !== expectedRestoreId) {
    throw new Error('the prepared restore no longer matches the preview being confirmed')
  }
  writeRestoreJournal({ ...read.journal, state: 'armed' })
  try {
    application.relaunch()
  } catch (error) {
    writeRestoreJournal(read.journal)
    throw error
  }
}
