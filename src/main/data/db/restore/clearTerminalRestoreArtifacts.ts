import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import { resolveUserDataRelativePath } from './resolveUserDataRelativePath'
import type { RestoreJournal } from './restoreJournal'

const logger = loggerService.withContext('clearTerminalRestoreArtifacts')

type TerminalJournal = Extract<RestoreJournal, { state: 'completed' | 'failed' | 'expired' }>

interface DynamicArtifact {
  readonly kind: 'db' | 'file'
  readonly path: string
}

function removeIfExists(target: string): void {
  fs.rmSync(target, { recursive: true, force: true })
}

function removeDbWithSidecars(dbPath: string): void {
  removeIfExists(dbPath)
  removeIfExists(`${dbPath}-wal`)
  removeIfExists(`${dbPath}-shm`)
}

function assertGone(target: string): void {
  if (fs.existsSync(target)) {
    throw new Error(`clearTerminalRestoreArtifacts: residue still present at ${target}`)
  }
}

/**
 * Clear terminal restore residue that would still affect preboot after a
 * successful DB/Data wipe. Only accepts absent or already-terminal journals —
 * staged/promoting/corrupt must be hard-rejected by DevResetCoordinator before
 * this is called.
 *
 * Validates ALL dynamic aside candidates first; any containment failure throws
 * before deletions. Static paths always come from `application.getPath()`.
 */
export function clearTerminalRestoreArtifacts(journal: TerminalJournal | undefined): void {
  if (journal && !['completed', 'failed', 'expired'].includes(journal.state)) {
    throw new Error(`clearTerminalRestoreArtifacts: non-terminal journal state '${journal.state}'`)
  }

  const journalPath = application.getPath('feature.backup.restore.file')
  const stagingRoot = application.getPath('feature.backup.restore.staging')
  const journalDir = path.dirname(journalPath)
  const journalBase = path.basename(journalPath)

  const dynamicTargets: DynamicArtifact[] = []
  if (journal) {
    dynamicTargets.push({ kind: 'db', path: resolveUserDataRelativePath(journal.db.aside) })
    for (const resource of journal.fileResources) {
      if (resource.asidePath) {
        dynamicTargets.push({ kind: 'file', path: resolveUserDataRelativePath(resource.asidePath) })
      }
    }
  }

  // Resolve the static quarantine candidates before deleting any dynamic artifact.
  // The journal directory is derived from the registered journal path, never from
  // a journal field.
  const corruptPaths = fs.existsSync(journalDir)
    ? fs
        .readdirSync(journalDir)
        .filter((name) => name.startsWith(`${journalBase}.corrupt-`))
        .map((name) => path.join(journalDir, name))
    : []

  // Deletions only after every dynamic path validated.
  for (const target of dynamicTargets) {
    if (target.kind === 'db') {
      removeDbWithSidecars(target.path)
    } else {
      removeIfExists(target.path)
    }
  }

  removeIfExists(journalPath)
  removeIfExists(`${journalPath}.tmp`)

  // Exact corrupt sidecars next to the journal (restorePromotion quarantine naming).
  for (const corruptPath of corruptPaths) removeIfExists(corruptPath)

  removeIfExists(stagingRoot)

  for (const target of dynamicTargets) {
    assertGone(target.path)
    if (target.kind === 'db') {
      assertGone(`${target.path}-wal`)
      assertGone(`${target.path}-shm`)
    }
  }
  for (const corruptPath of corruptPaths) assertGone(corruptPath)
  assertGone(journalPath)
  assertGone(`${journalPath}.tmp`)
  assertGone(stagingRoot)

  logger.info('Cleared terminal restore artifacts', {
    hadJournal: Boolean(journal),
    dynamicCount: dynamicTargets.length,
    corruptCount: corruptPaths.length
  })
}
