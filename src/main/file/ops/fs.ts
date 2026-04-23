/* oxlint-disable no-unused-vars -- TODO(phase-1b): Phase 1a stub exports; parameters shape the public signature but are unused until implementations land. */

/**
 * Core filesystem operations — the ONLY module that imports `node:fs`.
 *
 * All functions are pure path-based, no entry/DB awareness.
 *
 * ## Consumer responsibility
 *
 * `ops/fs` is open to the entire main process and performs no entry-awareness
 * checks. Callers MUST NOT use this module (directly or via a `FilePathHandle`)
 * to write or mutate paths under `{userData}/files/` — those back internal-origin
 * `FileEntry` rows whose `size` column is authoritative and kept in sync only by
 * FileManager's atomic write path. Bypassing it silently desyncs
 * `file_entry.size` from disk and leaves `versionCache` stale, with no
 * type-system or runtime guard.
 *
 * For writes targeting a FileEntry (internal or external), go through
 * `FileManager.write` / `writeIfUnchanged` / `createWriteStream`. Legitimate
 * `ops/*` consumers outside file_module (BootConfig, MCP oauth, user-picked
 * external paths, temporary artifacts, etc.) are unaffected — the rule is
 * specifically "do not point writes at the internal storage tree".
 *
 * See `docs/references/file/architecture.md §5.2` for the full rationale.
 */

import type { FilePath } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`ops.fs.${op}: not implemented (Phase 1a stub, implementation lands in Phase 1b)`)
}

/** Read file content as text with optional encoding detection. */
export async function read(_path: FilePath, _options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
export async function read(_path: FilePath, _options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
export async function read(
  _path: FilePath,
  _options: { encoding: 'binary' }
): Promise<{ data: Uint8Array; mime: string }>
export async function read(
  _path: FilePath,
  _options?: { encoding?: string; detectEncoding?: boolean }
): Promise<unknown> {
  return notImplemented('read')
}

/** Write content to a file path. Creates parent directories if needed. */
export async function write(_path: FilePath, _data: string | Uint8Array): Promise<void> {
  return notImplemented('write')
}

/** Get file/directory stats. */
export async function stat(
  _path: FilePath
): Promise<{ size: number; createdAt: number; modifiedAt: number; isDirectory: boolean }> {
  return notImplemented('stat')
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

/** Compute MD5 hash of file content. */
export async function hash(_path: FilePath): Promise<string> {
  return notImplemented('hash')
}
