import { promptTable } from '@data/db/schemas/prompt'
import { PromptService, promptService } from '@data/services/PromptService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PROMPT_ID_MISSING = '11111111-1111-4111-8111-111111111111'

async function seedPrompt(title = 'Hello', content = 'Prompt body') {
  return promptService.create({ title, content })
}

describe('PromptService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of PromptService', () => {
    expect(promptService).toBeInstanceOf(PromptService)
  })

  describe('create', () => {
    it('should create a prompt with title, content, timestamps, and an order key', async () => {
      const result = await promptService.create({ title: 'T1', content: 'C1' })

      expect(result).toMatchObject({ title: 'T1', content: 'C1' })
      expect(result.orderKey.length).toBeGreaterThan(0)
      expect(result.createdAt).toEqual(expect.any(String))
      expect(result.updatedAt).toEqual(expect.any(String))

      const [row] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, result.id))
      expect(row.orderKey.length).toBeGreaterThan(0)
      expect(row.title).toBe('T1')
      expect(row.content).toBe('C1')
    })

    it('should assign strictly increasing order keys on successive creates', async () => {
      const a = await promptService.create({ title: 'A', content: 'a' })
      const b = await promptService.create({ title: 'B', content: 'b' })
      const c = await promptService.create({ title: 'C', content: 'c' })

      const rows = await dbh.db.select().from(promptTable).orderBy(asc(promptTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id])
    })
  })

  describe('getAll', () => {
    it('should return prompts ordered by orderKey', async () => {
      const a = await seedPrompt('A', 'a')
      const b = await seedPrompt('B', 'b')

      const all = await promptService.getAll()
      expect(all.map((p) => p.id)).toEqual([a.id, b.id])
    })

    it('should return an empty array when no prompts exist', async () => {
      await expect(promptService.getAll()).resolves.toEqual([])
    })
  })

  describe('getById', () => {
    it('should return the prompt when found', async () => {
      const p = await seedPrompt()
      await expect(promptService.getById(p.id)).resolves.toMatchObject({ id: p.id, title: p.title, content: p.content })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.getById(PROMPT_ID_MISSING)).rejects.toBeInstanceOf(DataApiError)
      await expect(promptService.getById(PROMPT_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('update', () => {
    it('should update title and content in place', async () => {
      const p = await seedPrompt('title', 'original')

      const updated = await promptService.update(p.id, { title: 'renamed', content: 'edited' })

      expect(updated).toMatchObject({ id: p.id, title: 'renamed', content: 'edited' })
      const [row] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(row).toMatchObject({ title: 'renamed', content: 'edited' })
    })

    it('should support partial updates', async () => {
      const p = await seedPrompt('title', 'body')

      await expect(promptService.update(p.id, { title: 'renamed' })).resolves.toMatchObject({
        title: 'renamed',
        content: 'body'
      })
      await expect(promptService.update(p.id, { content: 'updated' })).resolves.toMatchObject({
        title: 'renamed',
        content: 'updated'
      })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.update(PROMPT_ID_MISSING, { title: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('delete', () => {
    it('should delete the prompt row', async () => {
      const p = await seedPrompt('t', 'v1')

      await promptService.delete(p.id)

      const prompts = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(prompts).toHaveLength(0)
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.delete(PROMPT_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorder', () => {
    it("should move a prompt to the first position via { position: 'first' }", async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      await promptService.reorder(c.id, { position: 'first' })

      const ids = (await promptService.getAll()).map((p) => p.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('should move a prompt to before an anchor', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      await promptService.reorder(c.id, { before: b.id })

      const ids = (await promptService.getAll()).map((p) => p.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should throw NOT_FOUND when the target does not exist', async () => {
      await expect(promptService.reorder(PROMPT_ID_MISSING, { position: 'first' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when the before anchor does not exist', async () => {
      const a = await seedPrompt('a', 'a')
      await expect(promptService.reorder(a.id, { before: PROMPT_ID_MISSING })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should touch only the target row', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      const [aBefore] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, a.id))
      const [bBefore] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, b.id))

      await promptService.reorder(c.id, { position: 'first' })

      const [aAfter] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, a.id))
      const [bAfter] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, b.id))
      const [cAfter] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, c.id))

      expect(aAfter.orderKey).toBe(aBefore.orderKey)
      expect(bAfter.orderKey).toBe(bBefore.orderKey)
      expect(cAfter.orderKey < aBefore.orderKey).toBe(true)
    })
  })

  describe('reorderBatch', () => {
    it('should apply multiple moves atomically per id', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      await promptService.reorderBatch([
        { id: c.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'last' } }
      ])

      const ids = (await promptService.getAll()).map((p) => p.id)
      expect(ids).toEqual([c.id, b.id, a.id])
    })

    it('should throw NOT_FOUND when a move references a missing anchor', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')

      await expect(
        promptService.reorderBatch([
          { id: a.id, anchor: { position: 'first' } },
          { id: b.id, anchor: { before: PROMPT_ID_MISSING } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })
})
