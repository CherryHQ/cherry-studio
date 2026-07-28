import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { hashDbFile } from '@data/db/restore/hashDbFile'

import { isKnowledgeDerivedIndexPath } from './archiveLayout'
import { type DirScanLimits, scanDirectoryUnit } from './dirScan'
import { BackupCancelledError } from './errors'

/**
 * Cryptographic + canonical hashing for the export producer (Phase 1b-i). All
 * hashes are SHA-256 in the repo's single representation (64 lowercase hex),
 * matching `Sha256HexSchema` in the manifest and `hashDbFile` for the DB.
 *
 * `sha256File` REUSES the shared streaming `hashDbFile` primitive rather than
 * duplicating a stream/hash pipeline — it is a generic streaming SHA-256 of any
 * file's bytes, not DB-specific.
 */
export const sha256File = hashDbFile

/** Re-export the (restricted, root-only) Knowledge exclusion predicate. */
export { isKnowledgeDerivedIndexPath }

/** Byte size of a regular file (follows the path; caller vets symlink/special separately). */
export async function fileSizeBytes(filePath: string): Promise<number> {
  const s = await stat(filePath)
  return s.size
}

/** Test seam: invoked per streamed chunk during a directory-unit or file hash (no-op in production). */
export const hashStreamHooks = {
  onChunk(_bytesSoFar: number): void {
    void _bytesSoFar
  }
}

/**
 * Streaming SHA-256 of a file that HONORS an AbortSignal — checked on every
 * chunk, so a multi-GB hash cancels promptly instead of running to completion
 * (unlike the aliased `sha256File`/`hashDbFile`, which cannot observe a signal).
 * Returns 64 lowercase hex. Reuses the same per-chunk pump as directory hashing,
 * so the `hashStreamHooks.onChunk` seam makes mid-hash cancellation deterministic.
 */
export async function sha256FileCancellable(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new BackupCancelledError()
  const hash = createHash('sha256')
  await streamFileInto(hash, filePath, signal)
  return hash.digest('hex')
}

export interface DirectoryUnitFile {
  /** POSIX relative path from the unit root. */
  readonly relPath: string
  readonly size: number
}

export interface DirectoryUnitHash {
  readonly hash: string
  readonly files: readonly DirectoryUnitFile[]
}

export interface HashDirectoryUnitOptions {
  readonly signal?: AbortSignal
  readonly excludeKnowledgeDerivedIndex?: boolean
  readonly limits?: DirScanLimits
}

function u64be(value: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(value))
  return b
}

/** Stream a file's bytes into `hash`, checking cancellation on EVERY chunk (not just up front). */
async function streamFileInto(
  hash: ReturnType<typeof createHash>,
  filePath: string,
  signal: AbortSignal | undefined
): Promise<number> {
  let bytes = 0
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(filePath)
    rs.on('data', (chunk) => {
      bytes += chunk.length
      hash.update(chunk)
      hashStreamHooks.onChunk(bytes)
      if (signal?.aborted) rs.destroy(new BackupCancelledError())
    })
    rs.on('error', reject)
    rs.on('end', resolve)
  })
  return bytes
}

/**
 * Canonical hash of a directory unit over both directory entries and regular
 * files from the shared scanner. Directories are framed as
 * `"D"‖u64be(len(path))‖path`; files as
 * `"F"‖u64be(len(path))‖path‖u64be(len(content))‖content`. Type tags and lengths
 * make every boundary unambiguous, while authenticating empty folders as part
 * of the unit instead of merely hashing its bytes. Cancellation is checked
 * during the scan, between entries, and on every streamed file chunk.
 */
export async function hashDirectoryUnit(
  rootDir: string,
  options: HashDirectoryUnitOptions = {}
): Promise<DirectoryUnitHash> {
  const scan = await scanDirectoryUnit(rootDir, {
    signal: options.signal,
    excludeKnowledgeDerivedIndex: options.excludeKnowledgeDerivedIndex,
    limits: options.limits
  })

  const hash = createHash('sha256')
  for (const dir of scan.dirs) {
    if (options.signal?.aborted) throw new BackupCancelledError()
    const pathBuf = Buffer.from(dir.relPath, 'utf8')
    hash.update('D')
    hash.update(u64be(pathBuf.length))
    hash.update(pathBuf)
  }

  const files: DirectoryUnitFile[] = []
  for (const entry of scan.entries) {
    if (options.signal?.aborted) throw new BackupCancelledError()
    const pathBuf = Buffer.from(entry.relPath, 'utf8')
    const abs = path.join(rootDir, ...entry.relPath.split('/'))
    hash.update('F')
    hash.update(u64be(pathBuf.length))
    hash.update(pathBuf)
    hash.update(u64be(entry.size))
    const streamed = await streamFileInto(hash, abs, options.signal)
    if (streamed !== entry.size) {
      throw new Error(
        `hashDirectoryUnit: file size changed during hashing (scan=${entry.size}, read=${streamed}): ${abs}`
      )
    }
    files.push({ relPath: entry.relPath, size: entry.size })
  }
  return { hash: hash.digest('hex'), files }
}
