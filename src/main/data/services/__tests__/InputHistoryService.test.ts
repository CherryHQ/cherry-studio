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

  it('trims content before saving', async () => {
    const item = await inputHistoryService.save({ content: '  hello  ' })

    expect(item.content).toBe('hello')

    const rows = await dbh.db.select().from(inputHistoryTable)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.content).toBe('hello')
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

  it('trims the oldest entries after reaching the history limit', async () => {
    for (let index = 0; index < INPUT_HISTORY_DEFAULT_LIMIT + 2; index += 1) {
      await inputHistoryService.save({ content: `content-${index}` })
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    const items = await inputHistoryService.list()
    const rows = await dbh.db.select().from(inputHistoryTable)

    expect(items).toHaveLength(INPUT_HISTORY_DEFAULT_LIMIT)
    expect(rows).toHaveLength(INPUT_HISTORY_DEFAULT_LIMIT)
    expect(items.map((item) => item.content)).not.toContain('content-0')
    expect(items.map((item) => item.content)).not.toContain('content-1')
    expect(items[0]!.content).toBe(`content-${INPUT_HISTORY_DEFAULT_LIMIT + 1}`)
  })
})
