import { KeyedMutex } from '@shared/utils/async'

import { validatePath } from './types'

/**
 * Serializes read-modify-write cycles per target path so parallel `edit`/`write`
 * calls to the same file cannot interleave and silently overwrite each other
 * (read stale content, write back, lose the other call's change). Different
 * paths hold different keys and still run concurrently.
 */
const mutationMutex = new KeyedMutex()

/**
 * Runs `fn` inside the per-path critical section for `requestedPath`. The
 * section covers the whole read-modify-write cycle; serializing only the final
 * write (or verifying with a post-write read) cannot stop a stale overwrite.
 */
export async function runFileMutation<T>(
  requestedPath: string,
  baseDir: string | undefined,
  fn: (validPath: string) => Promise<T>
): Promise<T> {
  // Validate once to derive the queue key: canonicalizing here maps different
  // spellings of the same target onto one queue. This comparison never leaves
  // the filesystem MCP server and does not alter shared workspace
  // authorization rules.
  const queueKey = await validatePath(requestedPath, baseDir)
  return mutationMutex.runExclusive(queueKey, async () => {
    // Re-validate inside the critical section: the target may have been
    // re-pointed while this call was queued, so the pre-wait authorization
    // must not be reused for the actual operation.
    const validPath = await validatePath(requestedPath, baseDir)
    return fn(validPath)
  })
}
