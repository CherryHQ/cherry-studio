/**
 * `withTempCopy(deps, id, fn)` — escape-hatch for libraries that only accept
 * file paths (sharp, pdf-lib, officeparser, OpenAI uploads, etc.).
 *
 * Copies the managed entry's content to an isolated temp directory, invokes
 * `fn(tempPath)`, and unconditionally cleans up the temp directory afterward
 * (whether `fn` resolves or throws). The temp copy is independent — if the
 * library writes to it, the original entry is unaffected.
 */

import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { copy as fsCopy, removeDir as fsRemoveDir } from '@main/utils/file/fs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('file/internal/system/tempCopy')

export async function withTempCopy<T>(
  deps: FileManagerDeps,
  id: FileEntryId,
  fn: (tempPath: string) => Promise<T>
): Promise<T> {
  const entry = await deps.fileEntryService.getById(id)
  const physical = resolvePhysicalPath(entry)
  // Centralised path: feature.files.tempcopy.temp is the parent dir; mkdtemp
  // appends a unique suffix per call so concurrent withTempCopy invocations
  // do not collide.
  const parent = application.getPath('feature.files.tempcopy.temp')
  const dir = await mkdtemp(path.join(parent, 'tc-'))
  const filename = `${entry.name}${entry.ext ? `.${entry.ext}` : ''}` || 'file'
  const target = path.join(dir, filename) as FilePath
  try {
    await fsCopy(physical, target)
    return await fn(target)
  } finally {
    // Cleanup must not hijack the original error. `fsRemoveDir` wraps
    // `fs.rm({ recursive: true, force: true })` so it tolerates ENOENT, but
    // EBUSY (Windows: external process holds the file) and EACCES (sandbox
    // containment changes) still throw — and a throw from finally would
    // replace any error fn just raised, erasing the caller's stack. Log and
    // swallow; the leaked directory lives under the OS temp tree (resolved
    // from the `feature.files.tempcopy.temp` path-registry key) and is reaped
    // on the next OS-level temp cleanup. No application-side sweeper is
    // planned.
    try {
      await fsRemoveDir(dir as FilePath)
    } catch (cleanupErr) {
      logger.warn('withTempCopy: temp dir cleanup failed; directory will leak until OS temp reap', {
        dir,
        err: cleanupErr
      })
    }
  }
}
