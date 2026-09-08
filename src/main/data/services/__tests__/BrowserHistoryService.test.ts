import { application } from '@application'
import { browserVisitTable } from '@data/db/schemas/browserVisit'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { browserHistoryService } from '../BrowserHistoryService'

const list = (search?: string, offset = 0, limit = 25) => browserHistoryService.list({ search, offset, limit })

describe('Browser history persistence', () => {
  const dbh = setupTestDatabase()

  it('persists sanitized visits across connections and keeps ordinary revisits distinct', () => {
    const url = 'https://alice:secret@example.com/report?token=private&q=hello&code=oauth#access_token=hidden'
    browserHistoryService.record({ url, title: url, visitedAt: 1234 })
    browserHistoryService.record({ url, title: 'Report', visitedAt: 5678 })
    const reopened = new Database(dbh.sqlite.name, { readonly: true })
    try {
      const rows = reopened.prepare('SELECT url, title, visited_at FROM browser_visit ORDER BY visited_at').all()
      expect(rows).toEqual([
        { url: 'https://example.com/report?q=hello', title: 'https://example.com/report?q=hello', visited_at: 1234 },
        { url: 'https://example.com/report?q=hello', title: 'Report', visited_at: 5678 }
      ])
    } finally {
      reopened.close()
    }
  })

  it.each([
    ['#api_key=private&session=private&signature=private&view=grid', '#view=grid'],
    ['#access%5Ftoken=private&%61uth=private', ''],
    ['#/reports?api_key=private&q=hello', '#/reports?q=hello'],
    ['#/reports?password=private', '#/reports'],
    ['#section-2', '#section-2'],
    ['#authentication', '#authentication'],
    ['#api_key=private?value&view=grid', '#view=grid'],
    ['#/reports?q=hello%20world', '#/reports?q=hello%20world']
  ])('sanitizes live and imported fragments while preserving navigation: %s', (fragment, expected) => {
    const url = `https://example.com/${fragment}`
    browserHistoryService.record({ url, title: url, visitedAt: 100 })
    browserHistoryService.importVisits([{ url, title: url, visitedAt: 200, source: 'chrome:Default' }])
    expect(dbh.sqlite.prepare('SELECT url, title FROM browser_visit ORDER BY visited_at').all()).toEqual([
      { url: `https://example.com/${expected}`, title: `https://example.com/${expected}` },
      { url: `https://example.com/${expected}`, title: `https://example.com/${expected}` }
    ])
  })

  it('deduplicates imports without changing original timestamps, and searches literal URL/title text', () => {
    const visits = [
      {
        url: 'https://one.test/100%',
        title: 'First report',
        visitedAt: 100,
        source: 'chrome:Default',
        sourceKey: 'one'
      },
      { url: 'https://two.test/', title: 'SECOND report', visitedAt: 200, source: 'firefox:profile', sourceKey: 'two' }
    ]
    expect(browserHistoryService.importVisits(visits)).toBe(2)
    expect(browserHistoryService.importVisits(visits)).toBe(0)
    expect(list('report', 0, 1)).toMatchObject({ items: [{ title: 'SECOND report', visitedAt: 200 }], hasMore: true })
    expect(list('report', 1, 1)).toMatchObject({ items: [{ title: 'First report', visitedAt: 100 }], hasMore: false })
    expect(list('%').items.map((row) => row.title)).toEqual(['First report'])
    expect(list('not found').items).toEqual([])
  })

  it('continues by timestamp and ID without skipping rows when newer records are inserted or deleted', () => {
    for (let i = 0; i < 5; i++)
      browserHistoryService.record({ url: `https://example.com/${i}`, title: String(i), visitedAt: 100 })
    const expected = list().items.map((item) => item.id)
    const first = list(undefined, 0, 2)
    expect(first.items.map((item) => item.id)).toEqual(expected.slice(0, 2))
    browserHistoryService.delete(first.items[0].id)
    browserHistoryService.record({ url: 'https://example.com/new', title: 'New visit', visitedAt: 200 })
    const next = browserHistoryService.list({ cursor: first.nextCursor, offset: 0, limit: 2 })
    const last = browserHistoryService.list({ cursor: next.nextCursor, offset: 0, limit: 2 })
    expect([...next.items, ...last.items].map((item) => item.id)).toEqual(expected.slice(2))
    expect(last.nextCursor).toBeUndefined()
    expect(last.hasMore).toBe(false)
  })

  it('shares cached icons across visits to the same site and clears them with history', () => {
    application
      .get('CacheService')
      .setPersist('browser.favicons', { 'https://example.com': 'data:image/png;base64,fixture' })
    browserHistoryService.record({ url: 'https://example.com/old', title: 'Old page', visitedAt: 100 })
    browserHistoryService.record({ url: 'https://other.test/', title: 'Other site', visitedAt: 200 })
    expect(list('Old page').items[0].favicon).toBe('data:image/png;base64,fixture')
    expect(list('Other site').items[0].favicon).toBeUndefined()
    browserHistoryService.clear()
    expect(application.get('CacheService').getPersist('browser.favicons')).toEqual({})
  })

  it('skips non-web/invalid visits and updates, deletes and clears stored records', () => {
    for (const url of ['file:///private/file.html', 'data:text/html,secret', 'about:blank', 'invalid']) {
      expect(browserHistoryService.record({ url, title: 'Excluded', visitedAt: 100 })).toBeUndefined()
    }
    expect(
      browserHistoryService.record({ url: 'http://localhost/', title: 'bad timestamp', visitedAt: NaN })
    ).toBeUndefined()
    const id = browserHistoryService.record({ url: 'http://192.168.1.2/', title: '', visitedAt: 100 })!
    browserHistoryService.updateTitle(id, 'Router', 'http://192.168.1.2/')
    expect(list('router').items).toMatchObject([{ id, title: 'Router' }])
    browserHistoryService.delete(id)
    expect(list().items).toEqual([])
    browserHistoryService.record({ url: 'http://localhost/', title: 'Local site', visitedAt: 100 })
    browserHistoryService.clear()
    expect(dbh.db.select().from(browserVisitTable).all()).toEqual([])
  })
})
