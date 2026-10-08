import { Mutex } from 'async-mutex'

import { getFileIdentity, isSameOrInside, normalizePathForComparison } from '@main/utils/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { validatePath } from './types'

interface PendingMutation {
  path: string
  probePath: AbsoluteFilePath
  identity: string | undefined
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
      for (const other of this.pending) {
        if (other.identity === undefined) {
          other.identity = await getFileIdentity(other.probePath)
        }
      }
      const identity = await getFileIdentity(canonicalPath)
      const predecessors = [...this.pending].filter(
        (other) =>
          path === other.path ||
          (identity !== undefined && other.identity !== undefined && identity === other.identity) ||
          (other.subtreeRoot && isSameOrInside(path, other.path)) ||
          (subtreeRoot && isSameOrInside(other.path, path))
      )
      const result = Promise.all(predecessors.map((other) => other.done)).then(() => fn(canonicalPath))
      const mutation: PendingMutation = {
        path,
        probePath: canonicalPath,
        identity,
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
