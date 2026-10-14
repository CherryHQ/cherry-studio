import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve a resume token to its on-disk pi session file. Returns `null` when the token is
 * format-valid but no matching file exists yet (pi persists the JSONL lazily, so a token can point
 * at a session that never flushed). The caller can initialize that ID through the SDK.
 * Throws only on a malformed token (path separators / traversal / illegal chars), which stays
 * fail-closed as the resume-dir attack-surface guard.
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []
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
