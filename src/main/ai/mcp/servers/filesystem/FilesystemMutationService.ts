import { Mutex } from 'async-mutex'

import { getFileIdentity, isSameOrInside, normalizePathForComparison } from '@main/utils/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { logger, validatePath } from './types'

interface PendingMutation {
  path: string
  probePath: AbsoluteFilePath
  identity: string | undefined
  /** False when the last identity probe failed (non-ENOENT): aliasing cannot be ruled out. */
  identityVerifiable: boolean
  subtreeRoot: boolean
  done: Promise<void>
}

class FilesystemMutationService {
  private readonly registrationMutex = new Mutex()
  private readonly pending = new Set<PendingMutation>()

  async runExclusive<T>(
    requestedPath: string,
    baseDir: string,
    fn: (canonicalPath: AbsoluteFilePath) => Promise<T>,
    opts?: { subtreeRoot?: boolean }
  ): Promise<T> {
    // Serialize registration only (not mutations). O(n) over pending ops is acceptable:
    // n is bounded by concurrent in-flight MCP calls, not workspace size.
    const { result } = await this.registrationMutex.runExclusive(async () => {
      const canonicalPath = await validatePath(requestedPath, baseDir)
      const path = normalizePathForComparison(canonicalPath)
      const subtreeRoot = opts?.subtreeRoot ?? false
      // Identity-probe failures must neither reject unrelated admissions nor fail
      // open: a hard link can alias any path on the same device, even across
      // workspace roots. When an identity is unverifiable the mutation is admitted
      // but serialized behind every pending entry it cannot be proven independent
      // of; freshly verified non-matching identities proceed concurrently.
      for (const other of this.pending) {
        try {
          other.identity = await getFileIdentity(other.probePath)
          other.identityVerifiable = true
        } catch (error) {
          if (typeof (error as NodeJS.ErrnoException)?.code !== 'string') throw error
          logger.warn('pending mutation identity refresh failed; treating as unverifiable', {
            code: (error as NodeJS.ErrnoException).code
          })
          other.identityVerifiable = false
        }
      }
      let identity: string | undefined
      let identityVerifiable = true
      try {
        identity = await getFileIdentity(canonicalPath)
      } catch (error) {
        if (typeof (error as NodeJS.ErrnoException)?.code !== 'string') throw error
        logger.warn('mutation target identity probe failed; treating as unverifiable', {
          code: (error as NodeJS.ErrnoException).code
        })
        identity = undefined
        identityVerifiable = false
      }
      const predecessors = [...this.pending].filter(
        (other) =>
          path === other.path ||
          !identityVerifiable ||
          !other.identityVerifiable ||
          (identity !== undefined && other.identity !== undefined && identity === other.identity) ||
          (other.subtreeRoot && isSameOrInside(path, other.path)) ||
          (subtreeRoot && isSameOrInside(other.path, path))
      )
      const result = Promise.all(predecessors.map((other) => other.done)).then(() => fn(canonicalPath))
      const mutation: PendingMutation = {
        path,
        probePath: canonicalPath,
        identity,
        identityVerifiable,
        subtreeRoot,
        done: result.then(
          () => undefined,
          () => undefined
        )
      }
      this.pending.add(mutation)
      void mutation.done.then(() => this.pending.delete(mutation))
      return { result }
    })
    return result
  }
}

export const filesystemMutationService = new FilesystemMutationService()
