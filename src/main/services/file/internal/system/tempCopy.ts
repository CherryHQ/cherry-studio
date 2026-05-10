/**
 * `withTempCopy(deps, id, fn)` — escape-hatch for libraries that only accept
 * file paths (sharp, pdf-lib, officeparser, OpenAI uploads, etc.).
 *
 * Copies the managed entry's content to an isolated temp directory, invokes
 * `fn(tempPath)`, and unconditionally cleans up the temp directory afterward
 * (whether `fn` resolves or throws). The temp copy is independent — if the
 * library writes to it, the original entry is unaffected.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { resolvePhysicalPath } from '@data/utils/pathResolver'
import { copy as fsCopy } from '@main/utils/file/fs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import type { FileManagerDeps } from '../deps'

export async function withTempCopy<T>(
  deps: FileManagerDeps,
  id: FileEntryId,
  fn: (tempPath: string) => Promise<T>
): Promise<T> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry) as FilePath
  const dir = await mkdtemp(path.join(tmpdir(), 'cherry-fm-tempcopy-'))
  const filename = `${entry.name}${entry.ext ? `.${entry.ext}` : ''}` || 'file'
  const target = path.join(dir, filename) as FilePath
  try {
    await fsCopy(physical, target)
    return await fn(target)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
