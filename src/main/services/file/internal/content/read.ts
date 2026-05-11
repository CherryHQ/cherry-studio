/**
 * Read content from a managed FileEntry or a raw FilePath.
 *
 * Pure functions taking FileManagerDeps as the first argument — call sites
 * are FileManager methods + IPC dispatchers. ENOENT on an external entry
 * triggers a `'missing'` ingestion into DanglingCache before re-throwing,
 * via the shared `observeExternalAccess` wrapper.
 */

import { resolvePhysicalPath } from '@data/utils/pathResolver'
import { read as fsRead, stat as fsStat } from '@main/utils/file/fs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import mime from 'mime'

import type { FileVersion, ReadResult } from '../../FileManager'
import type { FileManagerDeps } from '../deps'
import { observeExternalAccess } from '../observe'

type TextReadOptions = { encoding?: 'text'; detectEncoding?: boolean }
type Base64ReadOptions = { encoding: 'base64' }
type BinaryReadOptions = { encoding: 'binary' }

export async function read(
  deps: FileManagerDeps,
  id: FileEntryId,
  options?: TextReadOptions
): Promise<ReadResult<string>>
export async function read(
  deps: FileManagerDeps,
  id: FileEntryId,
  options: Base64ReadOptions
): Promise<ReadResult<string>>
export async function read(
  deps: FileManagerDeps,
  id: FileEntryId,
  options: BinaryReadOptions
): Promise<ReadResult<Uint8Array>>
export async function read(
  deps: FileManagerDeps,
  id: FileEntryId,
  options?: TextReadOptions | Base64ReadOptions | BinaryReadOptions
): Promise<ReadResult<string | Uint8Array>> {
  const entry = await deps.fileEntryService.getById(id)
  const physicalPath = resolvePhysicalPath(entry)
  return observeExternalAccess(deps, entry, physicalPath, () => readResolved(physicalPath, options))
}

export async function readByPath(
  _deps: FileManagerDeps,
  target: FilePath,
  options?: TextReadOptions | Base64ReadOptions | BinaryReadOptions
): Promise<ReadResult<string | Uint8Array>> {
  return readResolved(target, options)
}

async function readResolved(
  physicalPath: FilePath,
  options?: TextReadOptions | Base64ReadOptions | BinaryReadOptions
): Promise<ReadResult<string | Uint8Array>> {
  const s = await fsStat(physicalPath)
  const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
  const encoding = options?.encoding ?? 'text'
  if (encoding === 'text') {
    const content = await fsRead(physicalPath, { encoding: 'text' })
    const inferredMime = mime.getType(physicalPath) ?? 'text/plain'
    return { content, mime: inferredMime, version }
  }
  if (encoding === 'base64') {
    const out = await fsRead(physicalPath, { encoding: 'base64' })
    return { content: out.data, mime: out.mime, version }
  }
  const out = await fsRead(physicalPath, { encoding: 'binary' })
  return { content: out.data, mime: out.mime, version }
}
