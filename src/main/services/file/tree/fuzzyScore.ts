/**
 * Fuzzy scoring for directory search: which paths match a query and in what order. Pure, so the
 * Web edition's directory search (which cannot run ripgrep) ranks results the same way.
 */

import * as path from 'node:path'

// ─── Scoring constants ─────────────────────────────────────────────────────

const SCORE_SEGMENT_MATCH = 60
const SCORE_FILENAME_CONTAINS = 80
const SCORE_FILENAME_STARTS = 100
const SCORE_CONSECUTIVE_CHAR = 15
const SCORE_WORD_BOUNDARY = 20
const PATH_LENGTH_PENALTY_FACTOR = 4

// ─── Fuzzy scoring ─────────────────────────────────────────────────────────

/**
 * Fuzzy match: every char in `query` appears in `text` in order (case-insensitive).
 * Example: "updater" matches "packages/update/src/node/updateController.ts".
 */
function isFuzzyMatch(text: string, query: string): boolean {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  let i = 0
  let j = 0
  while (i < textLower.length && j < queryLower.length) {
    if (textLower[i] === queryLower[j]) j++
    i++
  }
  return j === queryLower.length
}

/**
 * Fuzzy match score (higher = better). Weighs segment matches, filename
 * prefix/contains, consecutive runs, word boundaries, with a log penalty
 * on path length so deeper paths don't dominate.
 */
function getFuzzyMatchScore(filePath: string, query: string): number {
  const pathLower = filePath.toLowerCase()
  const queryLower = query.toLowerCase()
  const fileName = filePath.split('/').pop() ?? ''
  const fileNameLower = fileName.toLowerCase()

  let score = 0

  const pathSegments = pathLower.split(/[/\\]/)
  let segmentMatchCount = 0
  for (const segment of pathSegments) {
    if (isFuzzyMatch(segment, queryLower)) segmentMatchCount++
  }
  score += segmentMatchCount * SCORE_SEGMENT_MATCH

  if (fileNameLower.startsWith(queryLower)) {
    score += SCORE_FILENAME_STARTS
  } else if (fileNameLower.includes(queryLower)) {
    score += SCORE_FILENAME_CONTAINS
  }

  let i = 0
  let j = 0
  let consecutiveCount = 0
  let maxConsecutive = 0
  while (i < pathLower.length && j < queryLower.length) {
    if (pathLower[i] === queryLower[j]) {
      consecutiveCount++
      maxConsecutive = Math.max(maxConsecutive, consecutiveCount)
      j++
    } else {
      consecutiveCount = 0
    }
    i++
  }
  score += maxConsecutive * SCORE_CONSECUTIVE_CHAR

  // Word-boundary bonus — only credit once to avoid inflating repeated patterns.
  const boundaryPrefix = queryLower.slice(0, Math.min(3, queryLower.length))
  const words = pathLower.split(/[/\\._-]/)
  for (const word of words) {
    if (word.startsWith(boundaryPrefix)) {
      score += SCORE_WORD_BOUNDARY
      break
    }
  }

  score -= Math.log(filePath.length + 1) * PATH_LENGTH_PENALTY_FACTOR

  return score
}

export interface ScoredSearchEntry {
  path: string
  isDirectory: boolean
  score: number
}

export function scoreFuzzyPaths(
  paths: readonly string[],
  resolvedPath: string,
  query: string,
  isDirectory: boolean
): ScoredSearchEntry[] {
  return paths
    .map((entryPath) => ({ entryPath, relativePath: path.relative(resolvedPath, entryPath).replace(/\\/g, '/') }))
    .filter(({ relativePath }) => isFuzzyMatch(relativePath, query))
    .map(({ entryPath, relativePath }) => ({
      path: entryPath,
      isDirectory,
      score: getFuzzyMatchScore(relativePath, query)
    }))
}

export function compareScoredSearchEntries(a: ScoredSearchEntry, b: ScoredSearchEntry): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.path.localeCompare(b.path)
}
