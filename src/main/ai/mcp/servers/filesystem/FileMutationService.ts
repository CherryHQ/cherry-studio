import { KeyedMutex } from '@shared/utils/async'

import { validatePath } from './types'

/**
 * Serializes read-modify-write cycles per target path so parallel `edit`/`write`
 * calls to the same file cannot interleave and silently overwrite each other
 * (read stale content, write back, lose the other call's change). Different
 * paths hold different keys and still run concurrently.
 *
 * The retained keyed mutex is cross-call coordination state, so per naming
 * conventions §5.2 this module is a direct-import singleton service rather
 * than a plain function module.
 */
class FileMutationService {
  private readonly mutationMutex = new KeyedMutex()

  /**
   * Runs `fn` inside the per-path critical section for `requestedPath`. The
   * section covers the whole read-modify-write cycle; serializing only the final
   * write (or verifying with a post-write read) cannot stop a stale overwrite.
   */
  async run<T>(requestedPath: string, baseDir: string | undefined, fn: (validPath: string) => Promise<T>): Promise<T> {
    // Loop instead of recursing: the old key's mutex must be fully released
    // before queuing under the new key, or two links flipped in opposite
    // directions could deadlock.
    for (;;) {
      // Validate once to derive the queue key: canonicalizing here maps different
      // spellings of the same target onto one queue. This comparison never leaves
      // the filesystem MCP server and does not alter shared workspace
      // authorization rules.
      const queueKey = await validatePath(requestedPath, baseDir)
      const outcome = await this.mutationMutex.runExclusive(
        queueKey,
        async (): Promise<{ retargeted: true } | { retargeted: false; value: T }> => {
          // Re-validate inside the critical section: the target may have been
          // re-pointed while this call was queued, so the pre-wait authorization
          // must not be reused for the actual operation.
          const validPath = await validatePath(requestedPath, baseDir)
          if (validPath !== queueKey) {
            // Retargeted while queued: running fn now would mutate the new target
            // under the old target's lock, bypassing the new target's queue.
            // Release and re-queue under the new canonical key.
            return { retargeted: true }
          }
          return { retargeted: false, value: await fn(validPath) }
        }
      )
      if (!outcome.retargeted) {
        return outcome.value
      }
    }
  }
}

export const fileMutationService = new FileMutationService()
