import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAbortError } from '@main/utils/error'
import { isSameOrInside, read, realpath, stat } from '@main/utils/file'
import type { WindowId } from '@shared/ipc/types'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type {
  NotesSearchMatch,
  NotesSearchOptions,
  NotesSearchQuery,
  NotesSearchResult,
  NotesTreeNode
} from '@shared/types/note'

const logger = loggerService.withContext('NotesSearchService')

const SEARCH_CONCURRENCY = 5
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
const DEFAULT_MAX_MATCHES_PER_FILE = 50
const DEFAULT_CONTEXT_LENGTH = 50
const MAX_RETURNED_LINE_LENGTH = 2_000
const SEARCH_YIELD_INTERVAL = 256

export interface NotesSearchRequestContext {
  readonly requestId: string
  readonly senderId: WindowId
}

interface SearchRequestState {
  readonly controller: AbortController
  readonly promise: Promise<NotesSearchResult[]>
  readonly requestId: string
}

interface SearchCandidate {
  readonly maxScore: number
  readonly node: NotesTreeNode
  readonly ordinal: number
}

interface RankedSearchResult {
  readonly ordinal: number
  readonly result: NotesSearchResult
}

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function flattenFileNodes(nodes: NotesTreeNode[]): NotesTreeNode[] {
  const files: NotesTreeNode[] = []
  const stack = [...nodes].reverse()

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue

    if (node.type === 'file') {
      files.push(node)
      continue
    }

    if (node.children) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index])
      }
    }
  }

  return files
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchFileName(node: NotesTreeNode, keyword: string, caseSensitive: boolean): boolean {
  const name = caseSensitive ? node.name : node.name.toLowerCase()
  const key = caseSensitive ? keyword : keyword.toLowerCase()
  return name.includes(key)
}

function getFileNameScore(node: NotesTreeNode, keyword: string): number {
  const normalizedName = node.name.toLowerCase()
  const normalizedKeyword = keyword.toLowerCase()

  if (normalizedName === normalizedKeyword) {
    return 200
  }
  return normalizedName.includes(normalizedKeyword) ? 100 : 0
}

function getRecencyScore(node: NotesTreeNode, searchStartedAt: number): number {
  const updatedAt = new Date(node.updatedAt).getTime()
  if (!Number.isFinite(updatedAt)) {
    return 0
  }

  const daysSinceUpdate = (searchStartedAt - updatedAt) / (1000 * 60 * 60 * 24)
  return Math.max(0, 10 - daysSinceUpdate)
}

function calculateRelevanceScore(
  node: NotesTreeNode,
  keyword: string,
  matches: NotesSearchMatch[],
  searchStartedAt: number
): number {
  let score = getFileNameScore(node, keyword)

  score += Math.min(matches.length * 2, 50)
  score += getRecencyScore(node, searchStartedAt)

  return score
}

function calculateMaxScore(
  node: NotesTreeNode,
  keyword: string,
  options: NotesSearchOptions,
  searchStartedAt: number
): number {
  const nameMatch = matchFileName(node, keyword, options.caseSensitive ?? false)
  const recencyScore = getRecencyScore(node, searchStartedAt)
  if (!Number.isFinite(recencyScore)) {
    return Number.POSITIVE_INFINITY
  }

  const maxMatchesPerFile = options.maxMatchesPerFile ?? DEFAULT_MAX_MATCHES_PER_FILE
  const maxContentScore =
    getFileNameScore(node, keyword) + Math.min(maxMatchesPerFile * 2, 50) + recencyScore + (nameMatch ? 100 : 0)

  return nameMatch ? Math.max(100, maxContentScore) : maxContentScore
}

function compareCandidates(left: SearchCandidate, right: SearchCandidate): number {
  const scoreOrder = right.maxScore - left.maxScore
  return Number.isNaN(scoreOrder) ? left.ordinal - right.ordinal : scoreOrder || left.ordinal - right.ordinal
}

function compareRankedResults(left: RankedSearchResult, right: RankedSearchResult): number {
  const scoreOrder = right.result.score - left.result.score
  return Number.isNaN(scoreOrder) ? left.ordinal - right.ordinal : scoreOrder || left.ordinal - right.ordinal
}

function candidateCanBeat(candidate: SearchCandidate, result: RankedSearchResult): boolean {
  if (!Number.isFinite(candidate.maxScore) || !Number.isFinite(result.result.score)) {
    return true
  }
  if (candidate.maxScore !== result.result.score) {
    return candidate.maxScore > result.result.score
  }
  return candidate.ordinal < result.ordinal
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return

  throw signal.reason instanceof Error ? signal.reason : createAbortError('Notes search aborted')
}

async function findMatches(
  content: string,
  keyword: string,
  options: NotesSearchOptions,
  signal: AbortSignal
): Promise<NotesSearchMatch[]> {
  const {
    caseSensitive = false,
    maxMatchesPerFile = DEFAULT_MAX_MATCHES_PER_FILE,
    contextLength = DEFAULT_CONTEXT_LENGTH
  } = options
  const flags = caseSensitive ? 'g' : 'gi'
  const pattern = new RegExp(escapeRegex(keyword), flags)
  const lines = content.split('\n')
  const matches: NotesSearchMatch[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % SEARCH_YIELD_INTERVAL === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throwIfAborted(signal)
    const line = lines[index]
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      throwIfAborted(signal)
      const matchStart = match.index
      const matchEnd = matchStart + match[0].length
      const beforeMatch = Math.min(2, matchStart)
      const contextStart = matchStart - beforeMatch
      const contextEnd = Math.min(line.length, matchEnd + contextLength)
      const prefix = contextStart > 0 ? '...' : ''
      const context = prefix + line.substring(contextStart, contextEnd)

      matches.push({
        lineNumber: index + 1,
        lineContent: line.length <= MAX_RETURNED_LINE_LENGTH ? line : context,
        matchStart: beforeMatch + prefix.length,
        matchEnd: matchEnd - matchStart + beforeMatch + prefix.length,
        context
      })

      if (matches.length >= maxMatchesPerFile) {
        return matches
      }

      if (match[0].length === 0) {
        pattern.lastIndex += 1
      }
    }
  }

  return matches
}

async function searchFileContent(
  node: NotesTreeNode,
  keyword: string,
  options: NotesSearchOptions,
  signal: AbortSignal,
  searchStartedAt: number,
  notesRoots: AbsoluteFilePath[]
): Promise<NotesSearchResult | null> {
  const parsedPath = AbsoluteFilePathSchema.safeParse(node.externalPath)
  if (!parsedPath.success) {
    logger.warn('Skipping note search for an invalid external path', { noteId: node.id })
    return null
  }

  try {
    throwIfAborted(signal)
    const realPath = await realpath(parsedPath.data)
    if (!notesRoots.some((root) => isSameOrInside(realPath, root))) {
      logger.warn('Skipping note search for a path outside the configured notes roots', { noteId: node.id })
      return null
    }

    const fileStat = await stat(realPath)
    throwIfAborted(signal)
    const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    if (!fileStat.isFile || fileStat.size > maxFileSize) {
      return null
    }

    const content = await read(realPath, { encoding: 'text', maxBytes: maxFileSize, signal })
    throwIfAborted(signal)
    if (!content || Buffer.byteLength(content, 'utf8') > maxFileSize) {
      return null
    }

    const matches = await findMatches(content, keyword, options, signal)
    if (matches.length === 0) {
      return null
    }

    return {
      ...node,
      matchType: 'content',
      matches,
      score: calculateRelevanceScore(node, keyword, matches, searchStartedAt)
    }
  } catch (error) {
    if (!isAbortError(error)) {
      logger.error('Failed to search note content', { noteId: node.id, error })
    }
    return null
  }
}

@Injectable('NotesSearchService')
@ServicePhase(Phase.WhenReady)
export class NotesSearchService extends BaseService {
  private readonly pendingRequests = new Set<Promise<NotesSearchResult[]>>()
  private readonly requests = new Map<WindowId, SearchRequestState>()
  private acceptingRequests = false
  private teardownPromise: Promise<void> | null = null

  async search(query: NotesSearchQuery, context: NotesSearchRequestContext): Promise<NotesSearchResult[]> {
    if (!this.acceptingRequests || query.maxResults <= 0) {
      return []
    }

    this.requests.get(context.senderId)?.controller.abort(createAbortError('Notes search superseded'))

    const controller = new AbortController()
    const promise = this.runSearch(query, controller)
    const state = { controller, promise, requestId: context.requestId }
    this.pendingRequests.add(promise)
    this.requests.set(context.senderId, state)

    try {
      return await promise
    } finally {
      this.pendingRequests.delete(promise)
      if (this.requests.get(context.senderId) === state) {
        this.requests.delete(context.senderId)
      }
    }
  }

  cancel(context: NotesSearchRequestContext): void {
    const request = this.requests.get(context.senderId)
    if (request?.requestId === context.requestId) {
      request.controller.abort(createAbortError('Notes search cancelled'))
    }
  }

  protected onInit(): void {
    this.acceptingRequests = true
    this.teardownPromise = null
  }

  protected onStop(): Promise<void> {
    return this.teardown('Notes search service stopped')
  }

  protected onDestroy(): Promise<void> {
    return this.teardown('Notes search service destroyed')
  }

  private async runSearch(query: NotesSearchQuery, controller: AbortController): Promise<NotesSearchResult[]> {
    const { nodes, keyword, options, maxResults } = query
    const searchStartedAt = Date.now()
    const notesRoots = await this.resolveNotesRoots()
    const candidates = flattenFileNodes(nodes)
      .map<SearchCandidate>((node, ordinal) => ({
        node,
        ordinal,
        maxScore: calculateMaxScore(node, keyword, options, searchStartedAt)
      }))
      .sort(compareCandidates)
    const results: RankedSearchResult[] = []
    const inFlight = new Map<number, SearchCandidate>()
    let nextIndex = 0
    let safelyPruned = false

    const addResult = (result: NotesSearchResult, ordinal: number): void => {
      results.push({ result, ordinal })
      results.sort(compareRankedResults)
      if (results.length > maxResults) {
        results.pop()
      }
    }

    const pruneIfSafe = (): void => {
      if (safelyPruned || controller.signal.aborted || results.length < maxResults) {
        return
      }

      const worstResult = results[results.length - 1]
      const nextCandidate = candidates[nextIndex]
      // Candidates are ordered by their maximum possible score. Once neither the best queued
      // candidate nor an in-flight candidate can enter the current top K, the exact result is known.
      const hasPossibleWinner =
        (nextCandidate ? candidateCanBeat(nextCandidate, worstResult) : false) ||
        [...inFlight.values()].some((candidate) => candidateCanBeat(candidate, worstResult))
      if (!hasPossibleWinner) {
        safelyPruned = true
        controller.abort(createAbortError('Notes search result limit safely resolved'))
      }
    }

    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const candidate = candidates[nextIndex]
        nextIndex += 1
        if (!candidate) return

        const { node, ordinal } = candidate
        inFlight.set(ordinal, candidate)

        const nameMatch = matchFileName(node, keyword, options.caseSensitive ?? false)
        const contentResult = await searchFileContent(
          node,
          keyword,
          options,
          controller.signal,
          searchStartedAt,
          notesRoots
        )
        inFlight.delete(ordinal)

        if (controller.signal.aborted) {
          return
        }

        let result: NotesSearchResult | null = null
        if (nameMatch && contentResult) {
          result = { ...contentResult, matchType: 'both', score: contentResult.score + 100 }
        } else if (nameMatch) {
          result = { ...node, matchType: 'filename', matches: [], score: 100 }
        } else if (contentResult) {
          result = contentResult
        }

        if (result) {
          addResult(result, ordinal)
        }
        pruneIfSafe()
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(SEARCH_CONCURRENCY, candidates.length) }, async () => {
        await worker()
      })
    )

    if (controller.signal.aborted && !safelyPruned) {
      return []
    }

    return results.sort(compareRankedResults).map(({ result }) => result)
  }

  private async resolveNotesRoots(): Promise<AbsoluteFilePath[]> {
    const configuredPath = application.get('PreferenceService').get('feature.notes.path').trim()
    const candidates = [application.getPath('feature.notes.data'), configuredPath]
    const roots = await Promise.all(
      candidates.map(async (candidate) => {
        const parsed = AbsoluteFilePathSchema.safeParse(candidate)
        if (!parsed.success) return null
        try {
          return await realpath(parsed.data)
        } catch {
          return null
        }
      })
    )

    return roots.filter((root): root is AbsoluteFilePath => root !== null)
  }

  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) {
      return this.teardownPromise
    }

    this.acceptingRequests = false
    const abortReason = createAbortError(reason)
    for (const { controller } of this.requests.values()) {
      controller.abort(abortReason)
    }
    const pending = [...this.pendingRequests]

    this.teardownPromise = Promise.allSettled(pending).then(() => {
      this.pendingRequests.clear()
      this.requests.clear()
    })
    return this.teardownPromise
  }
}
