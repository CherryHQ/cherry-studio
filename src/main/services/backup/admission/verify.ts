import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { ArchiveAdmissionError, BackupCancelledError, renderUntrustedName } from '../errors'
import { sha256FileCancellable } from '../hashing'
import type { BackupManifest } from '../manifest'
import { stagedDbName, stagedPathOf } from './extract'

function isContained(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep)
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

/**
 * Re-prove the extraction result over filesystem facts. Lite owns one directory
 * and permits exactly the two regular files that catalog/extraction created.
 */
export async function verifyStagedTree(stagingDir: string, signal: AbortSignal | undefined): Promise<void> {
  const realRoot = await realpath(stagingDir)
  const names = await readdir(realRoot)
  if (names.length !== 2 || !names.includes('manifest.json') || !names.includes('backup.sqlite')) {
    throw new ArchiveAdmissionError('layout', 'staged Lite archive does not contain exactly two files')
  }
  for (const name of names) {
    if (signal?.aborted) throw new BackupCancelledError()
    const absolute = path.join(realRoot, name)
    const node = await lstat(absolute)
    if (node.isSymbolicLink() || !node.isFile()) {
      throw new ArchiveAdmissionError(
        'staging-escape',
        `staged node is not a regular file: ${renderUntrustedName(name)}`
      )
    }
    if (!isContained(await realpath(absolute), realRoot)) {
      throw new ArchiveAdmissionError(
        'staging-escape',
        `staged node escapes root: ${renderUntrustedName(toPosixRel(realRoot, absolute))}`
      )
    }
  }
}

/** Recompute the staged DB size and SHA-256 before it can reach SQLite. */
export async function verifyDbPayload(
  stagingDir: string,
  manifest: BackupManifest,
  signal: AbortSignal | undefined
): Promise<void> {
  if (signal?.aborted) throw new BackupCancelledError()
  const dbPath = stagedPathOf(stagingDir, stagedDbName)
  const node = await stat(dbPath)
  if (node.size !== manifest.db.sizeBytes) {
    throw new ArchiveAdmissionError('payload-mismatch', `db size ${node.size} != manifest ${manifest.db.sizeBytes}`)
  }
  if ((await sha256FileCancellable(dbPath, signal)) !== manifest.db.hash) {
    throw new ArchiveAdmissionError('payload-mismatch', 'db sha256 != manifest')
  }
}
