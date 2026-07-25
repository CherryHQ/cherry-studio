/**
 * Read content from a managed FileEntry.
 *
 * ENOENT on an external entry triggers a `'missing'` ingestion into
 * DanglingCache before re-throwing, via the shared `observeExternalAccess`
 * wrapper.
 */

import type { FileEntryId } from '@shared/data/types/file'

import type { ReadResult } from '../../FileManager'
import { type Base64ReadOptions, type BinaryReadOptions, readByPath, type TextReadOptions } from '../../utils/content'
import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'
import { observeExternalAccess } from '../observe'

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
  return observeExternalAccess(deps, entry, physicalPath, () => readByPath(physicalPath, options))
}
