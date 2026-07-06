// Backup archive assembly — pack manifest + DB copy + file blobs + knowledge
// folders into a single .cbu (zip) archive.
//
// Layout (backup-architecture.md §2 + export-orchestrator.md "archive 文件结构"):
//   <archive>.cbu
//   ├── manifest.json     (at root)
//   ├── backup.sqlite     (online db.backup() copy of live)
//   ├── files/<fileId>    (file blobs, includeFiles=true / full preset only)
//   ├── knowledge/<baseId>/ (knowledge folders, includeKnowledgeFiles=true only)
//   └── notes/<relPath>   (Notes markdown bodies, full preset only)
//
// Lite mode omits files/ and knowledge/ (caller passes neither dir). Follows the
// archiver pattern established by LegacyBackupManager.ts (zlib level 1 + zip64)
// but adds two backup-critical guards that pattern lacks: ATOMIC write (write to
// a sibling temp file → rename on success) and FAIL-LOUD on any archiver warning
// (backup archives have no optional entries).

import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'

import { ZipArchive } from 'archiver'

import { BackupCancelledError, DiskFullError } from './errors'
import type { BackupManifest } from './manifest'

export interface ArchiveInputs {
  /** Serialized to `manifest.json` at the archive root. */
  readonly manifest: BackupManifest
  /** Path to the DB copy file → stored as `backup.sqlite`. Pre-statted; missing = throw. */
  readonly dbCopyPath: string
  /** Optional staged dir of file blobs (one file per fileId) → stored under `files/`. */
  readonly filesDir?: string
  /** Optional staged dir of knowledge folders (`<baseId>/...`) → stored under `knowledge/`. */
  readonly knowledgeDir?: string
  /** Optional staged dir of Notes markdown (`<relPath>...`) → stored under `notes/`. */
  readonly notesDir?: string
}

/**
 * Pack the export inputs into `outPath` (a .cbu zip). Writes to a sibling temp
 * file then atomically renames → a write failure (ENOSPC etc.) can never leave a
 * partial/corrupt archive at the user-visible `outPath`, nor destroy a prior good
 * backup that already lives there. Throws on any archiver error OR warning (every
 * entry in a backup archive is required).
 */
export async function assembleArchive(
  outPath: string,
  inputs: ArchiveInputs,
  signal?: AbortSignal
): Promise<void> {
  // Pre-stat the required DB copy so a missing/unreadable payload fails BEFORE
  // archiving. Without this, archiver would emit a 'warning' (not 'error') for the
  // missing file and finalize successfully — producing a .cbu without backup.sqlite.
  await stat(inputs.dbCopyPath)
  // Honor a pre-aborted signal before opening any stream (no temp file to clean up).
  if (signal?.aborted) throw new BackupCancelledError()

  const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
  // Sibling temp file guarantees the final rename is atomic (same filesystem; a
  // cross-filesystem tmp would EXDEV on rename). Hidden name so a crashed run
  // doesn't leave a visible partial .cbu.
  const tmpPath = join(dirname(outPath), `.${basename(outPath)}.${randomBytes(6).toString('hex')}.tmp`)
  const output = createWriteStream(tmpPath)

  try {
    await new Promise<void>((resolve, reject) => {
      // Resolve on the write stream's close (archiver fully flushed), reject on
      // any archiver OR write-stream error OR warning. `output.on('error')` is
      // mandatory: Node's `pipe()` destroys the source on a destination error but
      // does NOT re-emit it on the readable — without this listener a write
      // failure (ENOSPC / EACCES / bad path) would never reject and would hang.
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      // Backup archives have no optional entries — treat any archiver warning
      // (e.g. a file disappearing mid-directory-archive) as fatal.
      archive.on('warning', (err: Error & { code?: string }) => {
        reject(new Error(`archiver warning: ${err.code ?? ''} ${err.message}`))
      })
      // Cancel mid-archive: abort the archiver (stops entry reads) + reject so the
      // outer catch destroys the stream + unlinks the temp file. `once` auto-removes
      // on fire; the success path detaches via the listeners below.
      const onAbort = (): void => {
        archive.abort()
        reject(new BackupCancelledError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const detach = (): void => signal?.removeEventListener('abort', onAbort)
      output.once('close', detach)
      output.once('error', detach)
      archive.pipe(output)

      // manifest.json — Buffer-wrapped so archiver sizes the entry deterministically
      archive.append(Buffer.from(JSON.stringify(inputs.manifest, null, 2), 'utf8'), {
        name: 'manifest.json'
      })
      // backup.sqlite
      archive.file(inputs.dbCopyPath, { name: 'backup.sqlite' })
      // Optional file-blob + knowledge + notes trees
      if (inputs.filesDir) archive.directory(inputs.filesDir, 'files')
      if (inputs.knowledgeDir) archive.directory(inputs.knowledgeDir, 'knowledge')
      if (inputs.notesDir) archive.directory(inputs.notesDir, 'notes')

      // finalize() returns a Promise that can reject (zlib / source-stream error).
      // Route its rejection to the same reject so it doesn't surface as an
      // unhandled rejection (the 'error' event may also fire for the same cause;
      // double-reject is a no-op on a settled Promise).
      archive.finalize().catch(reject)
    })

    // Atomic replace — outPath now points at the fully-written archive.
    await rename(tmpPath, outPath)
  } catch (e) {
    // Abort the archiver + destroy the write stream BEFORE unlinking the temp
    // file — without this, a warning-triggered reject leaves the archive piping
    // into the open writeStream, and `unlink(tmpPath)` races with the in-flight
    // write. `destroy()` only STARTS closing the fd, so `finished(output)` waits
    // for the stream to actually close (on Windows unlink-while-open fails + gets
    // swallowed, leaving a hidden partial .cbu — waiting avoids that).
    archive.abort()
    output.destroy()
    await finished(output).catch(() => {})
    await unlink(tmpPath).catch(() => {})
    // Wrap ENOSPC (disk filled mid-archive — typically external blobs uncounted by
    // preflight) as DiskFullError for a clear renderer message (spec §磁盘预算 L254).
    throw (e as NodeJS.ErrnoException).code === 'ENOSPC' ? new DiskFullError() : e
  }
}
