import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { browserVisitTable } from '@data/db/schemas/browserVisit'
import type { BrowserVisit, ListBrowserVisitsQuery } from '@shared/data/api/schemas/browserVisits'
import { isSensitiveKey } from '@shared/utils/redaction'
import { desc, eq, or, sql } from 'drizzle-orm'

export interface BrowserVisitInput {
  url: string
  title: string
  visitedAt: number
  source?: string
  sourceKey?: string
}

function normalizeVisit(input: BrowserVisitInput) {
  const url = new URL(input.url)
  if (!['http:', 'https:'].includes(url.protocol) || !Number.isSafeInteger(input.visitedAt) || input.visitedAt < 0)
    return undefined
  url.username = ''
  url.password = ''
  for (const key of [...url.searchParams.keys()])
    if (isSensitiveKey(key) || /^(code|signature)$/i.test(key)) url.searchParams.delete(key)
  if (/(?:token|password|secret|code)=/i.test(url.hash)) url.hash = ''
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

  list(query: ListBrowserVisitsQuery): { items: BrowserVisit[]; hasMore: boolean } {
    const needle = query.search?.trim().toLowerCase()
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
        needle
          ? or(
              sql`instr(lower(${browserVisitTable.url}), ${needle}) > 0`,
              sql`instr(lower(${browserVisitTable.title}), ${needle}) > 0`
            )
          : undefined
      )
      .orderBy(desc(browserVisitTable.visitedAt), desc(browserVisitTable.id))
      .limit(query.limit + 1)
      .offset(query.offset)
      .all()
    return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit }
  }

  delete(id: string): void {
    application.get('DbService').getDb().delete(browserVisitTable).where(eq(browserVisitTable.id, id)).run()
    notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
  }
  clear(): void {
    application.get('DbService').getDb().delete(browserVisitTable).run()
    notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
  }
}

export const browserHistoryService = new BrowserHistoryService()
