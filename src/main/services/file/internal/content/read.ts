/**
 * Read content from a managed FileEntry.
 *
 * ENOENT on an external entry triggers a `'missing'` ingestion into
 * DanglingCache before re-throwing, via the shared `observeExternalAccess`
 * wrapper.
 */

import { loggerService } from '@logger'
import { logFailure } from '@main/core/logger/logFailure'
import type { FileEntryId } from '@shared/data/types/file'

import { classifyFileFailure } from '../../failureFacts'
import type { ReadResult } from '../../FileManager'
import {
  type Base64ReadOptions,
  type BinaryReadOptions,
  readByPath,
  readChunkByPath,
  type TextReadOptions
} from '../../utils/content'
import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'
import { observeExternalAccess } from '../observe'

const logger = loggerService.withContext('file/internal/read')

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
  const entry = deps.fileEntryService.getById(id)
  const physicalPath = resolvePhysicalPath(entry)
  try {
    return await observeExternalAccess(deps, entry, physicalPath, () => readByPath(physicalPath, options))
  } catch (error) {
    logFailure(logger, 'File read failed', error, 'file.read', classifyFileFailure(error, entry.origin === 'external'))
    throw error
  }
}

export async function readChunk(
  deps: FileManagerDeps,
  id: FileEntryId,
  offset: number,
  length: number
): Promise<ReadResult<Uint8Array>> {
  const entry = deps.fileEntryService.getById(id)
  const physicalPath = resolvePhysicalPath(entry)
  try {
    return await observeExternalAccess(deps, entry, physicalPath, () => readChunkByPath(physicalPath, offset, length))
  } catch (error) {
    logFailure(logger, 'File read failed', error, 'file.read', classifyFileFailure(error, entry.origin === 'external'))
    throw error
  }
}
