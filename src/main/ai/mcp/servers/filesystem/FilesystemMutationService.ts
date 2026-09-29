import { Mutex } from 'async-mutex'

import { getFileIdentity, isSameOrInside, normalizePathForComparison } from '@main/utils/file'

import { validatePath } from './types'

interface PendingMutation {
  path: string
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
    fn: () => Promise<T>,
    opts?: { subtreeRoot?: boolean }
  ): Promise<T> {
    // Serialize path/identity resolution and registration, not the mutations themselves.
    // This preserves call order across aliases without synchronous filesystem I/O.
    const { result } = await this.registrationMutex.runExclusive(async () => {
      const canonicalPath = await validatePath(requestedPath, baseDir)
      const path = normalizePathForComparison(canonicalPath)
      const identity = await getFileIdentity(canonicalPath)
      const subtreeRoot = opts?.subtreeRoot ?? false
      const predecessors = [...this.pending].filter(
        (other) =>
          path === other.path ||
          (identity !== undefined && identity === other.identity) ||
          (other.subtreeRoot && isSameOrInside(path, other.path)) ||
          (subtreeRoot && isSameOrInside(other.path, path))
      )
      const result = Promise.all(predecessors.map((other) => other.done)).then(fn)
      const mutation: PendingMutation = {
        path,
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
