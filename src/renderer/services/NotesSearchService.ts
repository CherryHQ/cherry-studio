import { loggerService } from '@logger'
import type { NotesTreeNode } from '@renderer/types/note'

const logger = loggerService.withContext('NotesSearchService')

/**
 * Search match result
 */
export interface SearchMatch {
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
  context: string
}

/**
 * Search result with match information
 */
export interface SearchResult extends NotesTreeNode {
  matchType: 'filename' | 'content' | 'both'
  /** Keyword occurrences in the note's name — 0 when only its content matched. */
  nameMatchCount: number
  /**
   * The name windowed around its first hit, so a match sitting past the row's
   * truncation point stays visible. Undefined when the name did not match.
   */
  nameContext?: string
  matches?: SearchMatch[]
  score: number
}

/**
 * Search options
 */
export interface SearchOptions {
  caseSensitive?: boolean
  useRegex?: boolean
  maxFileSize?: number
  maxMatchesPerFile?: number
  contextLength?: number
}

/**
 * Escape regex special characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the keyword matcher, so the name and content lanes agree on what counts
 * as a match.
 */
function buildKeywordPattern(keyword: string, caseSensitive: boolean, useRegex: boolean): RegExp {
  const flags = caseSensitive ? 'g' : 'gi'
  return useRegex ? new RegExp(keyword, flags) : new RegExp(escapeRegex(keyword), flags)
}

/** Characters of lead-in kept before a match, so the hit sits near the start. */
const CONTEXT_LEAD_CHARS = 2

/** Characters kept after a match in a windowed note name. */
const NAME_CONTEXT_LENGTH = 50

/**
 * Window `text` around one match so the hit stays visible in a space-constrained row:
 * keep a couple of characters of lead-in, then run on past the match. A `...` prefix
 * marks a trimmed head; the tail is left to the row's CSS truncation, so no suffix is
 * added. Returned offsets are relative to the returned `context`.
 */
function buildMatchContext(
  text: string,
  matchStart: number,
  matchEnd: number,
  contextLength: number
): { context: string; matchStart: number; matchEnd: number } {
  const lead = Math.min(CONTEXT_LEAD_CHARS, matchStart)
  const contextStart = matchStart - lead
  const contextEnd = Math.min(text.length, matchEnd + contextLength)
  const prefix = contextStart > 0 ? '...' : ''

  return {
    context: prefix + text.substring(contextStart, contextEnd),
    matchStart: lead + prefix.length,
    matchEnd: matchEnd - matchStart + lead + prefix.length
  }
}

/**
 * The note's name windowed around its first keyword hit (see
 * {@link buildMatchContext}). Undefined when the name does not match.
 */
export function buildNameContext(
  node: NotesTreeNode,
  keyword: string,
  options: SearchOptions = {}
): string | undefined {
  const { caseSensitive = false, useRegex = false } = options
  const match = buildKeywordPattern(keyword, caseSensitive, useRegex).exec(node.name)
  if (!match) {
    return undefined
  }

  return buildMatchContext(node.name, match.index, match.index + match[0].length, NAME_CONTEXT_LENGTH).context
}

/**
 * Count non-overlapping keyword occurrences in `text`. `lastIndex` is advanced past
 * a zero-length match so a regex keyword that can match empty cannot spin forever.
 */
export function countOccurrences(text: string, keyword: string, options: SearchOptions = {}): number {
  const { caseSensitive = false, useRegex = false } = options
  const pattern = buildKeywordPattern(keyword, caseSensitive, useRegex)

  let count = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    count += 1
    if (match[0].length === 0) {
      pattern.lastIndex += 1
    }
  }

  return count
}

/**
 * Calculate relevance score
 * - Filename match has higher priority
 * - More matches increase score
 * - More recent updates increase score
 */
export function calculateRelevanceScore(node: NotesTreeNode, keyword: string, matches: SearchMatch[]): number {
  let score = 0

  // Exact filename match (highest weight)
  if (node.name.toLowerCase() === keyword.toLowerCase()) {
    score += 200
  }
  // Filename contains match (high weight)
  else if (node.name.toLowerCase().includes(keyword.toLowerCase())) {
    score += 100
  }

  // Content match count
  score += Math.min(matches.length * 2, 50)

  // Recent updates boost score
  const daysSinceUpdate = (Date.now() - new Date(node.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  score += Math.max(0, 10 - daysSinceUpdate)

  return score
}

/**
 * Search file content for keyword matches
 */
export async function searchFileContent(
  node: NotesTreeNode,
  keyword: string,
  options: SearchOptions = {}
): Promise<SearchResult | null> {
  const {
    caseSensitive = false,
    useRegex = false,
    maxFileSize = 10 * 1024 * 1024, // 10MB
    maxMatchesPerFile = 50,
    contextLength = 50
  } = options

  try {
    if (node.type !== 'file') {
      return null
    }

    const content = await window.api.file.readExternal(node.externalPath)

    if (!content) {
      return null
    }

    if (content.length > maxFileSize) {
      logger.warn(`File too large to search: ${node.externalPath} (${content.length} bytes)`)
      return null
    }

    const pattern = buildKeywordPattern(keyword, caseSensitive, useRegex)

    const lines = content.split('\n')
    const matches: SearchMatch[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(line)) !== null) {
        const windowed = buildMatchContext(line, match.index, match.index + match[0].length, contextLength)

        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: windowed.matchStart,
          matchEnd: windowed.matchEnd,
          context: windowed.context
        })

        if (matches.length >= maxMatchesPerFile) {
          break
        }
      }

      if (matches.length >= maxMatchesPerFile) {
        break
      }
    }

    if (matches.length === 0) {
      return null
    }

    const score = calculateRelevanceScore(node, keyword, matches)

    return {
      ...node,
      matchType: 'content',
      nameMatchCount: 0,
      matches,
      score
    }
  } catch (error) {
    logger.error(`Failed to search file content for ${node.externalPath}:`, error as Error)
    return null
  }
}

/**
 * Count keyword occurrences in a node's name. Zero means the name did not match.
 */
export function countFileNameMatches(node: NotesTreeNode, keyword: string, options: SearchOptions = {}): number {
  return countOccurrences(node.name, keyword, options)
}

/**
 * Flatten tree to extract file nodes
 */
export function flattenTreeToFiles(nodes: NotesTreeNode[]): NotesTreeNode[] {
  const result: NotesTreeNode[] = []

  function traverse(nodes: NotesTreeNode[]) {
    for (const node of nodes) {
      if (node.type === 'file') {
        result.push(node)
      }
      if (node.children && node.children.length > 0) {
        traverse(node.children)
      }
    }
  }

  traverse(nodes)
  return result
}

/**
 * Search all files concurrently
 */
export async function searchAllFiles(
  nodes: NotesTreeNode[],
  keyword: string,
  options: SearchOptions = {},
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const startTime = performance.now()
  const CONCURRENCY = 5
  const results: SearchResult[] = []

  const fileNodes = flattenTreeToFiles(nodes)

  logger.debug(
    `Starting full-text search: keyword="${keyword}", totalFiles=${fileNodes.length}, options=${JSON.stringify(options)}`
  )

  const queue = [...fileNodes]

  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) {
        break
      }

      const node = queue.shift()
      if (!node) break

      const nameMatchCount = countFileNameMatches(node, keyword, options)
      const contentResult = await searchFileContent(node, keyword, options)

      if (nameMatchCount > 0 && contentResult) {
        results.push({
          ...contentResult,
          matchType: 'both',
          nameMatchCount,
          nameContext: buildNameContext(node, keyword, options),
          score: contentResult.score + 100
        })
      } else if (nameMatchCount > 0) {
        results.push({
          ...node,
          matchType: 'filename',
          nameMatchCount,
          nameContext: buildNameContext(node, keyword, options),
          matches: [],
          score: 100
        })
      } else if (contentResult) {
        results.push(contentResult)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fileNodes.length) }, () => worker()))

  const sortedResults = results.sort((a, b) => b.score - a.score)

  const endTime = performance.now()
  const duration = (endTime - startTime).toFixed(2)

  logger.debug(
    `Full-text search completed: keyword="${keyword}", duration=${duration}ms, ` +
      `totalFiles=${fileNodes.length}, resultsFound=${sortedResults.length}, ` +
      `filenameMatches=${sortedResults.filter((r) => r.matchType === 'filename').length}, ` +
      `contentMatches=${sortedResults.filter((r) => r.matchType === 'content').length}, ` +
      `bothMatches=${sortedResults.filter((r) => r.matchType === 'both').length}`
  )

  return sortedResults
}
