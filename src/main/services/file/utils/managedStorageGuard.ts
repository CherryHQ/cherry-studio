import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { isSameOrInside } from '@main/utils/file'

function overlaps(a: string, b: string): boolean {
  return isSameOrInside(a, b) || isSameOrInside(b, a)
}

async function nearestExistingRealPath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate)
  let probe = resolved
  for (;;) {
    try {
      const physical = await realpath(probe)
      return path.resolve(physical, path.relative(probe, resolved))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      const parent = path.dirname(probe)
      if (parent === probe) return resolved
      probe = parent
    }
  }
}

/**
 * Renderer-provided raw paths must never overlap FileManager-owned storage.
 *
 * Checks both lexical paths and real paths resolved through the nearest
 * existing parent so symlinks, not-yet-created destinations, and destructive
 * operations against an ancestor directory are all rejected.
 */
export async function assertOutsideManagedStorageMutation(...candidates: string[]): Promise<void> {
  const managedRoot = path.resolve(application.getPath('feature.files.data'))
  const managedRealRoot = await nearestExistingRealPath(managedRoot)

  for (const candidate of candidates) {
    const lexical = path.resolve(candidate)
    const physical = await nearestExistingRealPath(lexical)
    if (overlaps(lexical, managedRoot) || overlaps(physical, managedRealRoot)) {
      throw new Error(`Raw path mutation overlaps FileManager-owned storage: ${candidate}`)
    }
  }
}
