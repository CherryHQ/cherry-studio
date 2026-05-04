/**
 * mtime-based dedup cache for `fs__read`. Avoids re-emitting the same
 * file content to the model when nothing has changed between reads.
 *
 * Cache key is scoped by `topicId` so two parallel topics reading the
 * same file each get their own cache entry — a hit in topic A must not
 * suppress the read in topic B (the model in B has never seen it).
 *
 * "Hit" predicate: stored range fully contains requested range AND
 * mtime matches. When stored is `[a, b]` and requested is `[c, d]`,
 * we hit only if `a <= c && d <= b`. Asking for a wider window than
 * cached must re-read; the user genuinely needs the new lines.
 *
 * On hit, we return a sentinel that lets `readFile.ts` produce a
 * `kind: 'text'` result whose body is a `[unchanged since last read…]`
 * marker (the model pattern-matches on this prefix).
 */

import { application } from '@application'

const KEY_PREFIX = 'fs.read.dedup:'
// 5 minutes — covers an active conversation, expires on idle.
const TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  mtimeMs: number
  startLine: number
  endLine: number
  totalLines: number
  /** Wall-clock time of the read; surfaced in the unchanged marker. */
  readAtMs: number
}

function makeKey(topicId: string, absPath: string): string {
  return `${KEY_PREFIX}${topicId}:${absPath}`
}

export interface DedupHit {
  /** Body to surface to the model — already includes the [unchanged…] prefix. */
  text: string
  startLine: number
  endLine: number
  totalLines: number
}

/**
 * Returns a `DedupHit` if the cached entry covers the requested range
 * and mtime matches; otherwise `null`. Caller proceeds with a real read.
 */
export function checkDedup(
  topicId: string,
  absPath: string,
  mtimeMs: number,
  requestedStart: number,
  requestedEnd: number
): DedupHit | null {
  const cache = application.get('CacheService')
  const key = makeKey(topicId, absPath)
  const entry = cache.get<CacheEntry>(key)
  if (!entry) return null
  if (entry.mtimeMs !== mtimeMs) return null
  if (entry.startLine > requestedStart) return null
  // Clamp the requested end against the file's known total lines:
  // asking for L1-L2000 of a 5-line file is satisfied by the cached
  // L1-L5 because the file has no more lines to give.
  const effectiveEnd = Math.min(requestedEnd, entry.totalLines)
  if (entry.endLine < effectiveEnd) return null

  const ts = new Date(entry.readAtMs).toISOString()
  return {
    text: `[unchanged since last read at ${ts} — last range L${entry.startLine}-L${entry.endLine}]`,
    startLine: entry.startLine,
    endLine: entry.endLine,
    totalLines: entry.totalLines
  }
}

/**
 * Records a successful read so the next identical request hits.
 */
export function recordRead(
  topicId: string,
  absPath: string,
  mtimeMs: number,
  startLine: number,
  endLine: number,
  totalLines: number
): void {
  const cache = application.get('CacheService')
  const key = makeKey(topicId, absPath)
  cache.set<CacheEntry>(key, { mtimeMs, startLine, endLine, totalLines, readAtMs: Date.now() }, TTL_MS)
}
