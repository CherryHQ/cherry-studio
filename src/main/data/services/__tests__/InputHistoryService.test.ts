import { inputHistoryTable } from '@data/db/schemas/inputHistory'
import { inputHistoryService } from '@data/services/InputHistoryService'
import { INPUT_HISTORY_DEFAULT_LIMIT } from '@shared/data/api/schemas/inputHistory'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('InputHistoryService', () => {
  const dbh = setupTestDatabase()

  it('lists history from newest updatedAt to oldest', async () => {
    await dbh.db.insert(inputHistoryTable).values({
      content: 'old',
      createdAt: 1000,
      updatedAt: 1000
    })
    await dbh.db.insert(inputHistoryTable).values({
      content: 'new',
      createdAt: 2000,
      updatedAt: 2000
    })

    const items = await inputHistoryService.list()

    expect(items.map((item) => item.content)).toEqual(['new', 'old'])
  })

  it('enforces the documented list limit even when the table contains more rows', async () => {
    // Insert LIMIT + 5 rows directly. If the service forgot `.limit(...)`, list()
    // would return LIMIT + 5 items and the test would fail.
    for (let index = 0; index < INPUT_HISTORY_DEFAULT_LIMIT + 5; index += 1) {
      await dbh.db.insert(inputHistoryTable).values({
        content: `bulk-${index}`,
        createdAt: 1000 + index,
        updatedAt: 1000 + index
      })
    }

    const items = await inputHistoryService.list()

    expect(items).toHaveLength(INPUT_HISTORY_DEFAULT_LIMIT)
  })

  it('returns complete InputHistory fields (id, createdAt, updatedAt, content) with correct formats', async () => {
    const created = await inputHistoryService.save({ content: 'hello' })

    // uuidv7 id format: version 7 in the 13th hex group, variant bits in 17th-19th.
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(created.content).toBe('hello')
    // createdAt/updatedAt are ISO 8601 strings.
    expect(new Date(created.createdAt).toString()).not.toBe('Invalid Date')
    expect(new Date(created.updatedAt).toString()).not.toBe('Invalid Date')
    // For a brand new row, createdAt === updatedAt (same Date.now() call).
    expect(created.createdAt).toBe(created.updatedAt)
  })

  it('refreshes updatedAt (but not createdAt) when re-saving the same content', async () => {
    const first = await inputHistoryService.save({ content: 'repeat' })
    // Ensure updatedAt timestamps differ on platforms with millisecond resolution.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await inputHistoryService.save({ content: 'repeat' })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime())
  })

  it('trims content before saving', async () => {
    const item = await inputHistoryService.save({ content: '  hello  ' })

    expect(item.content).toBe('hello')

    const rows = await dbh.db.select().from(inputHistoryTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('hello')
  })

  it('moves duplicate content to the latest position instead of inserting another row', async () => {
    await inputHistoryService.save({ content: 'repeat' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    await inputHistoryService.save({ content: 'other' })
    await new Promise((resolve) => setTimeout(resolve, 1))
    await inputHistoryService.save({ content: 'repeat' })

    const rows = await dbh.db.select().from(inputHistoryTable)
    const items = await inputHistoryService.list()

    expect(rows).toHaveLength(2)
    expect(items.map((item) => item.content)).toEqual(['repeat', 'other'])
  })

  it('trims the oldest entries after reaching the history limit (keeps exactly N, not N-1)', async () => {
    for (let index = 0; index < INPUT_HISTORY_DEFAULT_LIMIT + 2; index += 1) {
      await inputHistoryService.save({ content: `content-${index}` })
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    const items = await inputHistoryService.list()
    const rows = await dbh.db.select().from(inputHistoryTable)

    expect(items).toHaveLength(INPUT_HISTORY_DEFAULT_LIMIT)
    expect(rows).toHaveLength(INPUT_HISTORY_DEFAULT_LIMIT)

    // The two oldest (content-0, content-1) are gone.
    expect(items.map((item) => item.content)).not.toContain('content-0')
    expect(items.map((item) => item.content)).not.toContain('content-1')

    // Boundary check: the most recent two inserts are kept. If the trim threshold
    // is "off by one" in either direction, this assertion catches it. With LIMIT=20
    // and 22 inserts, the kept set is content-2..content-21 (newest first), so
    // content-1 is the oldest survivor-of-trim and content-2 is the oldest retained.
    const contents = items.map((item) => item.content)
    expect(contents).toContain(`content-${INPUT_HISTORY_DEFAULT_LIMIT}`) // 20
    expect(contents).toContain(`content-${INPUT_HISTORY_DEFAULT_LIMIT + 1}`) // 21
    expect(contents).toContain('content-2') // oldest retained
    expect(contents).not.toContain('content-1') // oldest trimmed
    expect(contents).not.toContain('content-0') // oldest trimmed

    // The newest entry must lead the DESC list.
    expect(items[0].content).toBe(`content-${INPUT_HISTORY_DEFAULT_LIMIT + 1}`)
  })
})
