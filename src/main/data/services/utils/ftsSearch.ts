import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import { buildKeywordRegexes, type KeywordMatchMode, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import { stripMarkdownFormatting } from '@shared/utils/searchSnippet'
import { type SQL, sql } from 'drizzle-orm'

import { asNumericKey, encodeCursor, parseCursor } from './keysetCursor'

const DEFAULT_FTS_SEARCH_LIMIT = 500
const FTS_SEARCH_CHUNK_SIZE = 200
const FTS_SEARCH_MAX_CANDIDATES = 5_000

const logger = loggerService.withContext('FtsSearch')

export type SearchCursor = {
  id: string
  createdAt: number
}

export type SearchFetchContext = {
  ftsConditions: SQL[]
  cursor: SearchCursor | undefined
  createdAtFromMs: number | undefined
  offset: number
  chunkSize: number
}

export type SearchMapContext = {
  terms: string[]
  matchMode: KeywordMatchMode
  snippet: string
}

type CursorConfig = {
  fieldMessage: string
  errorMessage: string
}

type BuildSnippet = (text: string, terms: string[], matchMode: KeywordMatchMode) => string

type SearchMappedItem<PublicItem> = {
  item: PublicItem
  sort: SearchCursor
}

type SearchWithCursorOptions<Row, PublicItem> = {
  q: string
  limit?: number
  cursor?: string
  createdAtFrom?: string
  maxCandidates?: number
  cursorConfig: CursorConfig
  fetchRows: (context: SearchFetchContext) => Promise<Row[]>
  getSearchableText: (row: Row) => string
  buildSnippet: BuildSnippet
  mapRow: (row: Row, context: SearchMapContext) => SearchMappedItem<PublicItem>
}

function invalidCursor(config: CursorConfig) {
  return DataApiErrorFactory.validation({ cursor: [config.fieldMessage] }, config.errorMessage)
}

// Search decode policy: a malformed cursor is a client contract violation and
// throws 422 (unlike list browsing, which warns and falls back to first page).
// The `<key>:<id>` parsing itself is shared via `parseCursor`.
export function decodeSearchCursor(raw: string, config: CursorConfig): SearchCursor {
  const parsed = parseCursor(raw, asNumericKey)
  if (!parsed) {
    throw invalidCursor(config)
  }
  return { createdAt: parsed.key, id: parsed.id }
}

export function encodeSearchCursor(createdAt: number, id: string): string {
  return encodeCursor(createdAt, id)
}

export function buildFtsLikePattern(term: string): string {
  // Keep LIKE free of ESCAPE so SQLite can use the trigram FTS LIKE index;
  // regex validation below preserves literal substring semantics.
  return `%${term}%`
}

export function getCreatedAtFromMs(createdAtFrom: string | undefined): number | undefined {
  if (!createdAtFrom) return undefined
  const value = Date.parse(createdAtFrom)
  return Number.isFinite(value) ? value : undefined
}

export async function searchWithCursor<Row, PublicItem>({
  q,
  limit = DEFAULT_FTS_SEARCH_LIMIT,
  cursor: rawCursor,
  createdAtFrom,
  maxCandidates = FTS_SEARCH_MAX_CANDIDATES,
  cursorConfig,
  fetchRows,
  getSearchableText,
  buildSnippet,
  mapRow
}: SearchWithCursorOptions<Row, PublicItem>): Promise<CursorPaginationResponse<PublicItem>> {
  const terms = splitKeywordsToTerms(q)
  if (terms.length === 0) return { items: [] }

  const matchMode: KeywordMatchMode = 'substring'
  const fetchLimit = limit + 1
  const regexes = buildKeywordRegexes(terms, { matchMode, flags: 'i' })
  const ftsConditions = terms.map((term) => sql`fts.searchable_text LIKE ${buildFtsLikePattern(term)}`)
  const cursor = rawCursor !== undefined ? decodeSearchCursor(rawCursor, cursorConfig) : undefined
  const createdAtFromMs = getCreatedAtFromMs(createdAtFrom)
  const results: Array<SearchMappedItem<PublicItem>> = []
  let offset = 0
  let scannedCandidates = 0

  while (results.length < fetchLimit) {
    const rows = await fetchRows({
      ftsConditions,
      cursor,
      createdAtFromMs,
      offset,
      chunkSize: FTS_SEARCH_CHUNK_SIZE
    })

    if (rows.length === 0) break
    scannedCandidates += rows.length
    offset += rows.length

    for (const row of rows) {
      const searchableText = getSearchableText(row)
      if (!searchableText) continue

      const plainText = stripMarkdownFormatting(searchableText)
      const matches = regexes.every((regex) => {
        regex.lastIndex = 0
        return regex.test(plainText)
      })
      if (!matches) continue

      results.push(
        mapRow(row, {
          terms,
          matchMode,
          snippet: buildSnippet(searchableText, terms, matchMode)
        })
      )

      if (results.length >= fetchLimit) break
    }

    if (scannedCandidates >= maxCandidates && results.length < fetchLimit) {
      logger.warn('FTS search candidate scan limit reached', {
        scannedCandidates,
        limit,
        maxCandidates,
        termCount: terms.length
      })
      break
    }
  }

  const itemsWithCursor = results.slice(0, limit)
  const nextCursorBoundary = results.length > limit ? itemsWithCursor.at(-1) : undefined
  return {
    items: itemsWithCursor.map((result) => result.item),
    nextCursor: nextCursorBoundary
      ? encodeSearchCursor(nextCursorBoundary.sort.createdAt, nextCursorBoundary.sort.id)
      : undefined
  }
}
