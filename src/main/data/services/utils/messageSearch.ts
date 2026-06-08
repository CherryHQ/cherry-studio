import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import { buildKeywordRegexes, type KeywordMatchMode, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import { buildSearchSnippet, stripMarkdownFormatting } from '@shared/utils/messageSearch'
import { type SQL, sql } from 'drizzle-orm'

const DEFAULT_MESSAGE_SEARCH_LIMIT = 500
const MESSAGE_SEARCH_CHUNK_SIZE = 200

export type MessageSearchCursor = {
  id: string
  createdAt: number
}

export type MessageSearchFetchContext = {
  ftsConditions: SQL[]
  cursor: MessageSearchCursor | undefined
  createdAtFromMs: number | undefined
  offset: number
  chunkSize: number
}

export type MessageSearchMapContext = {
  terms: string[]
  matchMode: KeywordMatchMode
  snippet: string
}

type CursorConfig = {
  fieldMessage: string
  errorMessage: string
}

type SearchMessagesWithCursorOptions<Row, InternalItem, PublicItem> = {
  q: string
  limit?: number
  cursor?: string
  createdAtFrom?: string
  cursorConfig: CursorConfig
  fetchRows: (context: MessageSearchFetchContext) => Promise<Row[]>
  getSearchableText: (row: Row) => string
  mapRow: (row: Row, context: MessageSearchMapContext) => InternalItem
  toPublicItem: (item: InternalItem) => PublicItem
  getCursorCreatedAt: (item: InternalItem) => number
  getCursorId: (item: InternalItem) => string
}

function invalidCursor(config: CursorConfig) {
  return DataApiErrorFactory.validation({ cursor: [config.fieldMessage] }, config.errorMessage)
}

export function decodeMessageSearchCursor(raw: string, config: CursorConfig): MessageSearchCursor {
  const sep = raw.indexOf(':')
  if (sep < 0) {
    throw invalidCursor(config)
  }

  const key = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!key || !id) {
    throw invalidCursor(config)
  }

  const createdAt = Number(key)
  if (!Number.isFinite(createdAt)) {
    throw invalidCursor(config)
  }

  return { createdAt, id }
}

export function encodeMessageSearchCursor(createdAt: number, id: string): string {
  return `${createdAt}:${id}`
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

export function coerceSearchRole<TRole extends string>(
  role: string,
  allowedRoles: readonly TRole[]
): TRole | undefined {
  return allowedRoles.includes(role as TRole) ? (role as TRole) : undefined
}

export async function searchMessagesWithCursor<Row, InternalItem, PublicItem>({
  q,
  limit = DEFAULT_MESSAGE_SEARCH_LIMIT,
  cursor: rawCursor,
  createdAtFrom,
  cursorConfig,
  fetchRows,
  getSearchableText,
  mapRow,
  toPublicItem,
  getCursorCreatedAt,
  getCursorId
}: SearchMessagesWithCursorOptions<Row, InternalItem, PublicItem>): Promise<CursorPaginationResponse<PublicItem>> {
  const terms = splitKeywordsToTerms(q)
  if (terms.length === 0) return { items: [] }

  const matchMode: KeywordMatchMode = 'substring'
  const fetchLimit = limit + 1
  const regexes = buildKeywordRegexes(terms, { matchMode, flags: 'i' })
  const ftsConditions = terms.map((term) => sql`fts.searchable_text LIKE ${buildFtsLikePattern(term)}`)
  const cursor = rawCursor !== undefined ? decodeMessageSearchCursor(rawCursor, cursorConfig) : undefined
  const createdAtFromMs = getCreatedAtFromMs(createdAtFrom)
  const results: InternalItem[] = []
  let offset = 0

  while (results.length < fetchLimit) {
    const rows = await fetchRows({
      ftsConditions,
      cursor,
      createdAtFromMs,
      offset,
      chunkSize: MESSAGE_SEARCH_CHUNK_SIZE
    })

    if (rows.length === 0) break
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
          snippet: buildSearchSnippet(searchableText, terms, matchMode)
        })
      )

      if (results.length >= fetchLimit) break
    }
  }

  const itemsWithCursor = results.slice(0, limit)
  const nextCursorBoundary = results.length > limit ? itemsWithCursor.at(-1) : undefined
  return {
    items: itemsWithCursor.map(toPublicItem),
    nextCursor: nextCursorBoundary
      ? encodeMessageSearchCursor(getCursorCreatedAt(nextCursorBoundary), getCursorId(nextCursorBoundary))
      : undefined
  }
}
