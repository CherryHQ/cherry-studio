/**
 * `Edit(<path-glob>)` content matcher for `fs__patch`.
 *
 * Reads the patch envelope, extracts every affected absolute path
 * (from `*** Add/Update/Delete File: ...` headers), and tests them
 * against the rule's glob via `picomatch`.
 *
 * Match semantics depend on `behavior`:
 *   - 'deny'  → match if **any** path is in the glob (conservative).
 *   - 'allow' → match only if **every** path is in the glob (so a multi-
 *     path patch with one out-of-bound file isn't auto-approved by a
 *     narrow allow rule).
 *   - 'ask'   → same shape as allow (match only if every path covered).
 */

import type { ContentMatcher } from '@main/services/toolApproval/matcher'
import picomatch from 'picomatch'

const HEADER_RE = /^\*\*\*\s+(Add|Update|Delete)\s+File:\s+(.+)\s*$/gm

export const matchFsPatchRule: ContentMatcher = (input, ruleContent, _ctx, behavior) => {
  const patch = readPatch(input)
  if (patch === null) return false
  const paths = extractPaths(patch)
  if (paths.length === 0) return false

  const isMatch = picomatch(ruleContent, { dot: true })

  if (behavior === 'deny') return paths.some((p) => isMatch(p))
  return paths.every((p) => isMatch(p))
}

function readPatch(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const p = (input as { patch?: unknown }).patch
  return typeof p === 'string' ? p : null
}

function extractPaths(patch: string): string[] {
  const paths: string[] = []
  HEADER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HEADER_RE.exec(patch)) !== null) {
    paths.push(match[2].trim())
  }
  return paths
}
