/* oxlint-disable no-unused-vars -- TODO(phase-1b): write/copy/move/etc. remain Phase 1a stubs; their parameters shape the public signature but are unused until implementations land in Phase 1b.2. */

/**
 * Core filesystem operations — the ONLY module that imports `node:fs`.
 *
 * All functions are pure path-based, no entry/DB awareness.
 *
 * ## Consumer responsibility
 *
 * `@main/utils/file/fs` is open to the entire main process and performs no
 * entry-awareness checks. Callers MUST NOT use this module (directly or via a
 * `FilePathHandle`) to write or mutate paths under `{userData}/files/` —
 * those back internal-origin `FileEntry` rows whose `size` column is
 * authoritative and kept in sync only by FileManager's atomic write path.
 * Bypassing it silently desyncs `file_entry.size` from disk and leaves
 * `versionCache` stale, with no type-system or runtime guard.
 *
 * For writes targeting a FileEntry (internal or external), go through
 * `FileManager.write` / `writeIfUnchanged` / `createWriteStream`. Legitimate
 * consumers of these primitives outside the file module (BootConfig, MCP
 * oauth, user-picked external paths, temporary artifacts, etc.) are
 * unaffected — the rule is specifically "do not point writes at the internal
 * storage tree".
 *
 * See `docs/references/file/architecture.md §5.2` for the full rationale.
 */

import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, constants, open as fsOpen, readFile, rename, stat as fsStat, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import md5 from 'md5'
import mime from 'mime'

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/fs.${op}: not implemented (Phase 1a stub, implementation lands in Phase 1b)`)
}

/** Read file content as text with optional encoding detection. */
export async function read(path: FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
export async function read(path: FilePath, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
export async function read(path: FilePath, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>
export async function read(
  path: FilePath,
  options?: { encoding?: 'text' | 'base64' | 'binary'; detectEncoding?: boolean }
): Promise<unknown> {
  const encoding = options?.encoding ?? 'text'
  if (encoding === 'text') {
    return readFile(path, 'utf-8')
  }
  const buf = await readFile(path)
  const inferredMime = mime.getType(path) ?? 'application/octet-stream'
  if (encoding === 'base64') {
    return { data: buf.toString('base64'), mime: inferredMime }
  }
  return { data: new Uint8Array(buf), mime: inferredMime }
}

/** Returns true iff the path exists and is readable by the current process. */
export async function exists(path: FilePath): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Write content to a file path. Creates parent directories if needed. */
export async function write(_path: FilePath, _data: string | Uint8Array): Promise<void> {
  return notImplemented('write')
}

function tmpNameFor(target: string): string {
  return `${target}.tmp-${randomUUID()}`
}

/** Path-level version captured from `fs.stat`. Mirrors `FileVersion`'s shape but lives here so this module is self-contained. */
export interface PathVersion {
  mtime: number
  size: number
}

/**
 * Path-level version-mismatch error. Thrown by `atomicWriteIfUnchanged`.
 *
 * `internal/content/write.writeIfUnchanged` catches this and re-wraps it in
 * the entry-aware `StaleVersionError` exported by `FileManager.ts`.
 */
export class PathStaleVersionError extends Error {
  constructor(
    public readonly target: FilePath,
    public readonly expected: PathVersion,
    public readonly current: PathVersion
  ) {
    super(
      `Path ${target} version mismatch: expected mtime=${expected.mtime} size=${expected.size}, ` +
        `got mtime=${current.mtime} size=${current.size}`
    )
    this.name = 'PathStaleVersionError'
  }
}

/**
 * Atomic write: tmp + fsync + rename + fsync(dir).
 *
 * Follows the POSIX atomic flow documented in
 * `docs/references/file/file-manager-architecture.md §5.1`:
 * 1. open `{target}.tmp-{uuid}` in the same directory
 * 2. write data, fsync the tmp fd
 * 3. rename(tmp, target) — atomic replacement on POSIX
 * 4. fsync(dir fd) — flush rename metadata; ignored on Windows
 *
 * On rename failure the tmp file is best-effort unlinked before the error
 * is rethrown. The target file is therefore never partially written —
 * callers either see the previous content or the new content.
 */
export async function atomicWriteFile(target: FilePath, data: string | Uint8Array): Promise<void> {
  const tmp = tmpNameFor(target)
  const tmpHandle = await fsOpen(tmp, 'w')
  try {
    await tmpHandle.writeFile(data)
    await tmpHandle.sync()
  } finally {
    await tmpHandle.close()
  }
  try {
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  try {
    const dirHandle = await fsOpen(path.dirname(target), 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // Windows / unsupported FS — non-fatal; rename already committed.
  }
}

/**
 * Optimistic-concurrency atomic write.
 *
 * Re-stats the target and compares against `expected`:
 * - byte-exact `(mtime, size)` match → write proceeds via `atomicWriteFile`
 * - mismatch → throws `PathStaleVersionError` without touching the target
 * - **ambiguous** (`mtime ms === 0` AND `size === expected.size`) → second-
 *   precision FS scenario; the implementation needs `expectedContentHash` to
 *   distinguish "same file" from "stealth edit". When omitted the write
 *   proceeds (no false-positive throw); when supplied a content-hash fallback
 *   compares before deciding.
 *
 * Returns the new on-disk version on success.
 */
export async function atomicWriteIfUnchanged(
  target: FilePath,
  data: string | Uint8Array,
  expected: PathVersion,
  expectedContentHash?: string
): Promise<PathVersion> {
  const s = await fsStat(target)
  const current: PathVersion = { mtime: Math.floor(s.mtimeMs), size: s.size }
  const sizeMatch = current.size === expected.size
  const mtimeMatch = current.mtime === expected.mtime
  const ambiguousMtime = sizeMatch && current.mtime % 1000 === 0 && expected.mtime % 1000 === 0
  if (!(sizeMatch && mtimeMatch) && !ambiguousMtime) {
    throw new PathStaleVersionError(target, expected, current)
  }
  if (ambiguousMtime && expectedContentHash !== undefined) {
    const actualHash = await hash(target)
    if (actualHash !== expectedContentHash) {
      throw new PathStaleVersionError(target, expected, current)
    }
  }
  await atomicWriteFile(target, data)
  const s2 = await fsStat(target)
  return { mtime: Math.floor(s2.mtimeMs), size: s2.size }
}

/** Get file/directory stats. */
export async function stat(
  path: FilePath
): Promise<{ size: number; createdAt: number; modifiedAt: number; isDirectory: boolean }> {
  const s = await fsStat(path)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory()
  }
}

/** Copy a file from source to destination. */
export async function copy(_src: FilePath, _dest: FilePath): Promise<void> {
  return notImplemented('copy')
}

/** Move/rename a file or directory. */
export async function move(_src: FilePath, _dest: FilePath): Promise<void> {
  return notImplemented('move')
}

/** Remove a file. */
export async function remove(_path: FilePath): Promise<void> {
  return notImplemented('remove')
}

/** Remove a directory recursively. */
export async function removeDir(_path: FilePath): Promise<void> {
  return notImplemented('removeDir')
}

/** Create a directory (recursive). */
export async function mkdir(_path: FilePath): Promise<void> {
  return notImplemented('mkdir')
}

/** Ensure a directory exists (no-op if already present). */
export async function ensureDir(_path: FilePath): Promise<void> {
  return notImplemented('ensureDir')
}

/** Compress an image (sharp). Returns the output path. */
export async function compressImage(_input: FilePath | Uint8Array, _output: FilePath): Promise<void> {
  return notImplemented('compressImage')
}

/** Download a URL to a local file path. */
export async function download(_url: string, _dest: FilePath): Promise<void> {
  return notImplemented('download')
}

/**
 * Compute MD5 hash of file content (streaming).
 *
 * MD5 is the Phase 1a contract algorithm. Migration to xxhash-128 is deferred
 * to Phase 1b.2 (versionCache content-hash fallback) where dep-add can be
 * scoped together with the actual consumer.
 */
export async function hash(path: FilePath): Promise<string> {
  const chunks: Buffer[] = []
  const stream = createReadStream(path)
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return md5(Buffer.concat(chunks))
}
