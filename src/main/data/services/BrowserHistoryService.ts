import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { browserVisitTable } from '@data/db/schemas/browserVisit'
import type { BrowserVisit, ListBrowserVisitsQuery } from '@shared/data/api/schemas/browserVisits'
import { isSensitiveKey } from '@shared/utils/redaction'
import { and, eq, or, sql } from 'drizzle-orm'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

export interface BrowserVisitInput {
  url: string
  title: string
  visitedAt: number
  source?: string
  sourceKey?: string
}

function removeSensitiveParameters(params: URLSearchParams): void {
  for (const key of [...params.keys()]) {
    if (isSensitiveKey(key) || /^(code|signature)$/i.test(key)) {
      params.delete(key)
    }
  }
}

function normalizeVisit(input: BrowserVisitInput) {
  const url = new URL(input.url)
  if (!['http:', 'https:'].includes(url.protocol) || !Number.isSafeInteger(input.visitedAt) || input.visitedAt < 0)
    return undefined
  url.username = ''
  url.password = ''
  removeSensitiveParameters(url.searchParams)
  const fragment = url.hash.slice(1)
  const path = fragment.split('?', 1)[0]
  // Fragment parameters can carry credentials under arbitrary names; retain only navigation anchors/routes.
  url.hash = path.includes('=') || path.includes('&') ? '' : path
  if (url.href.length > 16_384) return undefined
  return {
    ...input,
    url: url.href,
    title: (input.title === input.url ? url.href : input.title).slice(0, 1_000),
    source: input.source ?? 'local'
  }
}

export class BrowserHistoryService {
  record(input: BrowserVisitInput): string | undefined {
    let value
    try {
      value = normalizeVisit(input)
    } catch {
      return undefined
    }
    if (!value) return undefined
    const id = application
      .get('DbService')
      .getDb()
      .insert(browserVisitTable)
      .values(value)
      .onConflictDoNothing()
      .returning({ id: browserVisitTable.id })
      .get()?.id
    if (id) notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
    return id
  }

  importVisits(inputs: BrowserVisitInput[]): number {
    const values = inputs.flatMap((input) => {
      try {
        const value = normalizeVisit(input)
        return value ? [value] : []
      } catch {
        return []
      }
    })
    const service = application.get('DbService')
    const count = service.withWriteTx(() => {
      let inserted = 0
      for (const value of values)
        inserted += service.getDb().insert(browserVisitTable).values(value).onConflictDoNothing().run().changes
      return inserted
    })
    if (count) notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
    return count
  }

  updateTitle(id: string, title: string, url: string): void {
    const value = normalizeVisit({ url, title, visitedAt: 0 })
    if (value)
      application
        .get('DbService')
        .getDb()
        .update(browserVisitTable)
        .set({ title: value.title })
        .where(eq(browserVisitTable.id, id))
        .run()
    notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership', dimension: 'search' }])
  }

  list(query: ListBrowserVisitsQuery): { items: BrowserVisit[]; hasMore: boolean; nextCursor?: string } {
    const needle = query.search?.trim().toLowerCase()
    const ordering = keysetOrdering(browserVisitTable.visitedAt, browserVisitTable.id, { major: 'desc', tie: 'desc' })
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'browser-history')
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        id: browserVisitTable.id,
        url: browserVisitTable.url,
        title: browserVisitTable.title,
        visitedAt: browserVisitTable.visitedAt,
        source: browserVisitTable.source
      })
      .from(browserVisitTable)
      .where(
        and(
          cursor ? ordering.where(cursor) : undefined,
          needle
            ? or(
                sql`instr(lower(${browserVisitTable.url}), ${needle}) > 0`,
                sql`instr(lower(${browserVisitTable.title}), ${needle}) > 0`
              )
            : undefined
        )
      )
      .orderBy(...ordering.orderBy)
      .limit(query.limit + 1)
      .offset(cursor ? 0 : query.offset)
      .all()
    const icons = application.get('CacheService').getPersist('browser.favicons')
    const items = rows.slice(0, query.limit).map((row) => ({ ...row, favicon: icons[new URL(row.url).origin] }))
    const last = items.at(-1)
    const hasMore = rows.length > query.limit
    return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.visitedAt, last.id) : undefined }
  }

  delete(id: string): void {
    application.get('DbService').getDb().delete(browserVisitTable).where(eq(browserVisitTable.id, id)).run()
    notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
  }
  clear(): void {
    application.get('CacheService').deletePersist('browser.favicons')
    application.get('DbService').getDb().delete(browserVisitTable).run()
    notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
  }
}

export const browserHistoryService = new BrowserHistoryService()
