// Backup archive assembly — pack manifest + DB copy + file blobs + knowledge
// folders into a single .cherrybackup (zip) archive.
//
// Layout (backup-architecture.md §2 + the archive file layout):
//   <archive>.cherrybackup
//   ├── manifest.json     (at root)
//   ├── backup.sqlite     (online db.backup() copy of live)
//   ├── files/<fileId>    (file blobs, includeFiles=true / full preset only)
//   ├── knowledge/<baseId>/ (knowledge folders, includeKnowledgeFiles=true only)
//   ├── skills/<folderName>/ (installed skill dirs, full preset only — zip/local)
//   └── notes/<relPath>   (Notes markdown bodies, full preset only)
//
// Lite mode omits files/ and knowledge/ (caller passes neither dir). Follows the
// archiver pattern established by LegacyBackupManager.ts (zlib level 1 + zip64)
// but adds two backup-critical guards that pattern lacks: ATOMIC write (write to
// a sibling temp file → link on success; rename fallback on hard-link-unsupported
// volumes) and FAIL-LOUD on any archiver warning
// (backup archives have no optional entries).

import { randomBytes } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { copyFile, link, open as fsOpen, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'

import { ZipArchive } from 'archiver'

import { BackupCancelledError, DiskFullError, OutputPathExistsError } from './errors'
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
  /** Optional staged dir of skill folders (`<folderName>/...`) → stored under `skills/` (full preset only). */
  readonly skillsDir?: string
  /** Optional staged dir of Notes markdown (`<relPath>...`) → stored under `notes/`. */
  readonly notesDir?: string
}

/**
 * fsync helpers for archive publish durability (review-M3). Object form so unit
 * tests can spy/mock without fighting same-module local bindings.
 */
export const archiveDurability = {
  async fsyncPath(target: string): Promise<void> {
    const fh = await fsOpen(target, 'r')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
  },

  /**
   * Directory-entry durability after publish. Windows cannot fsync directory
   * handles (MoveFileEx / link metadata accepted as best-effort — same trade-off
   * as writeRestoreJournal).
   */
  async fsyncParentDir(filePath: string): Promise<void> {
    if (process.platform === 'win32') return
    await archiveDurability.fsyncPath(dirname(filePath))
  }
}

/**
 * Pack the export inputs into `outPath` (a .cherrybackup zip). Writes to a sibling temp
 * file then atomically links → a write failure (ENOSPC etc.) can never leave a
 * partial/corrupt archive at the user-visible `outPath`, nor destroy a prior good
 * backup that already lives there. Throws on any archiver error OR warning (every
 * entry in a backup archive is required).
 */
export async function assembleArchive(
  outPath: string,
  inputs: ArchiveInputs,
  signal?: AbortSignal,
  overwrite = false
): Promise<void> {
  // Pre-stat the required DB copy so a missing/unreadable payload fails BEFORE
  // archiving. Without this, archiver would emit a 'warning' (not 'error') for the
  // missing file and finalize successfully — producing a .cherrybackup without backup.sqlite.
  await stat(inputs.dbCopyPath)
  // No-clobber (default): refuse to overwrite an existing file. archive publishes via
  // link() (EEXIST = no-clobber, atomic) with a rename fallback only on hard-link-unsupported
  // volumes (which can overwrite — guarded by this stat + the entry validateOutputPath).
  // Defense-in-depth alongside BackupService.validateOutputPath (entry check); this
  // brackets the small TOCTOU window between entry and archive completion.
  // overwrite=true opts into atomic replace instead (see the publish step below), so the
  // existence pre-check is skipped — validateOutputPath already gated it at entry.
  if (!overwrite) {
    try {
      await stat(outPath)
      throw new OutputPathExistsError(outPath)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  // Honor a pre-aborted signal before opening any stream (no temp file to clean up).
  if (signal?.aborted) throw new BackupCancelledError()

  const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
  // Sibling temp file guarantees the final link is atomic (same filesystem; a
  // cross-filesystem tmp would EXDEV on rename). Hidden name so a crashed run
  // doesn't leave a visible partial .cherrybackup.
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
      // Optional file-blob + knowledge + skills + notes trees
      if (inputs.filesDir) archive.directory(inputs.filesDir, 'files')
      if (inputs.knowledgeDir) archive.directory(inputs.knowledgeDir, 'knowledge')
      if (inputs.skillsDir) archive.directory(inputs.skillsDir, 'skills')
      if (inputs.notesDir) archive.directory(inputs.notesDir, 'notes')

      // finalize() returns a Promise that can reject (zlib / source-stream error).
      // Route its rejection to the same reject so it doesn't surface as an
      // unhandled rejection (the 'error' event may also fire for the same cause;
      // double-reject is a no-op on a settled Promise).
      archive.finalize().catch(reject)
    })

    // Durability gate BEFORE publish: flush the tmp inode so a power loss after
    // link/copy cannot leave a zero-byte / torn .cherrybackup at outPath while the caller
    // already observed success. Same POSIX fsync-before-rename pattern as
    // writeRestoreJournal (review-M3).
    await archiveDurability.fsyncPath(tmpPath)

    // Atomic publish. overwrite=false (default): no-clobber via hard-link
    // (EEXIST = no-clobber, atomic, no data copy) with a copyFile(COPYFILE_EXCL) fallback
    // for volumes that reject hard-links (exFAT / some network → ENOTSUP/EOPNOTSUPP/ENOSYS).
    // overwrite=true: atomic replace via rename() of the fsynced sibling temp over outPath.
    // POSIX rename is atomic on the same filesystem (tmp is a sibling of outPath → same
    // volume), so the visible file flips old→new in one step: never torn, and a failure
    // leaves the prior backup intact (the durability gate above already fsynced tmp).
    let publishedViaCopy = false
    if (overwrite) {
      // rename overwrites atomically; tmp is consumed (becomes outPath), so no tmp cleanup.
      await rename(tmpPath, outPath)
    } else {
      try {
        await link(tmpPath, outPath)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'EEXIST') throw new OutputPathExistsError(outPath)
        if (code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw e
        // Hard-link unsupported on this volume — fallback to copyFile with COPYFILE_EXCL
        // (cross-platform no-clobber; EEXIST re-thrown as OutputPathExistsError).
        try {
          await copyFile(tmpPath, outPath, constants.COPYFILE_EXCL)
          publishedViaCopy = true
        } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') throw new OutputPathExistsError(outPath)
          // A partial copy (ENOSPC / interrupted) can leave a truncated outPath that
          // blocks retry (the no-clobber check sees it). Remove it before propagating.
          await unlink(outPath).catch(() => {})
          throw e2
        }
      }
    }
    // copyFile creates a new inode — fsync it too (hard-link/rename share the already-
    // fsynced tmp inode). Then fsync the parent dir so the new directory entry
    // itself is durable on POSIX.
    if (publishedViaCopy) await archiveDurability.fsyncPath(outPath)
    await archiveDurability.fsyncParentDir(outPath)
    // Commit point reached (link/copy/rename succeeded) — outPath holds the archive. tmp
    // cleanup is best-effort (rename already consumed tmp; unlink is a no-op then): a
    // cleanup failure must NOT turn a successful export into a reported failure (the outer
    // catch would otherwise rethrow, and a retry would then hit BACKUP_OUTPUT_PATH_EXISTS
    // on the already-written archive).
    await unlink(tmpPath).catch(() => {})
  } catch (e) {
    // Abort the archiver + destroy the write stream BEFORE unlinking the temp
    // file — without this, a warning-triggered reject leaves the archive piping
    // into the open writeStream, and `unlink(tmpPath)` races with the in-flight
    // write. `destroy()` only STARTS closing the fd, so `finished(output)` waits
    // for the stream to actually close (on Windows unlink-while-open fails + gets
    // swallowed, leaving a hidden partial .cherrybackup — waiting avoids that).
    archive.abort()
    output.destroy()
    await finished(output).catch(() => {})
    await unlink(tmpPath).catch(() => {})
    // Wrap ENOSPC (disk filled mid-archive — typically external blobs uncounted by
    // preflight) as DiskFullError for a clear renderer message (BackupService.preflightDisk, the 1.2x safety budget).
    throw (e as NodeJS.ErrnoException).code === 'ENOSPC' ? new DiskFullError() : e
  }
}
