/**
 * `Bash(<ruleContent>)` content matcher for the central pipeline.
 *
 * Grammar:
 *   "name args:*"            → matches `name args` and `name args ...`
 *   "name args:prefix*"      → matches `name args prefix...`
 *   "name args:exact tail"   → matches exactly `name args exact tail`
 *   "name" (no colon)         → matches exactly `name`
 *   "literal && pipeline"    → matches that exact source (whitespace-collapsed)
 *
 * Sync by design — `ContentMatcher` runs in the L4 hot path; the
 * structural / safety analysis happens in L3 (`classifier.ts`) where
 * we can afford async parsing. This matcher is text-only.
 *
 * `behavior` (allow/deny/ask) is ignored — match semantics for shell
 * commands are inherently single-input (no aggregation needed).
 */

import type { ContentMatcher } from '@main/services/toolApproval/matcher'

export const matchBashRule: ContentMatcher = (input, ruleContent) => {
  const command = readCommand(input)
  if (command === null) return false

  const cmdNorm = collapseWhitespace(command)
  const ruleNorm = collapseWhitespace(ruleContent)

  const colon = ruleNorm.indexOf(':')
  if (colon === -1) {
    // Bare rule — must match the input exactly (whitespace-collapsed).
    return cmdNorm === ruleNorm
  }

  const head = ruleNorm.slice(0, colon)
  const tail = ruleNorm.slice(colon + 1)

  if (tail === '*') {
    // Any-args: input must equal head, OR start with `${head} `.
    return cmdNorm === head || cmdNorm.startsWith(`${head} `)
  }

  // Match `<head> <tail>` with optional `*` suffix on tail.
  if (tail.endsWith('*')) {
    const tailPrefix = tail.slice(0, -1)
    return cmdNorm.startsWith(`${head} ${tailPrefix}`)
  }

  return cmdNorm === `${head} ${tail}`
}

function readCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const c = (input as { command?: unknown }).command
  return typeof c === 'string' ? c : null
}

function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}
