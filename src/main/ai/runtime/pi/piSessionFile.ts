import { readdirSync } from 'node:fs'
import path from 'node:path'

import { getErrorCode } from '@main/utils/error'

/**
 * Resolve a resume token to its on-disk pi session file. Returns `null` when the token is
 * format-valid but no matching file exists yet (pi persists the JSONL lazily, so a token can point
 * at a session that never flushed). The caller can initialize that ID through the SDK.
 * Rejects malformed tokens (path separators / traversal / illegal chars) and propagates
 * directory read failures other than ENOENT.
 */
export function resolveResumeTokenSessionFile(resumeToken: string, sessionDir: string): string | null {
  if (
    !resumeToken ||
    resumeToken !== path.basename(resumeToken) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(resumeToken)
  ) {
    throw new Error('pi resume token must be a valid session id inside Cherry-owned session dir')
  }

  let entries: string[]

  try {
    entries = readdirSync(sessionDir)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') entries = []
    else throw error
  }

  // pi owns the timestamped filename prefix; Cherry persists the stable id suffix.
  // If the same id is recreated, the lexicographically greatest timestamp is the newest state.
  const match = entries
    .filter((entry) => entry.endsWith(`_${resumeToken}.jsonl`))
    .sort()
    .at(-1)

  return match ? path.join(sessionDir, match) : null
}
