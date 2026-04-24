import { promptTable, promptVersionTable } from '@data/db/schemas/prompt'
import { PromptService, promptService } from '@data/services/PromptService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PROMPT_ID_MISSING = '11111111-1111-4111-8111-111111111111'

async function seedPrompt(title = 'Hello', content = 'v1 body', variables: unknown = null) {
  return promptService.create({
    title,
    content,
    variables: variables as Parameters<typeof promptService.create>[0]['variables']
  })
}

describe('PromptService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of PromptService', () => {
    expect(promptService).toBeInstanceOf(PromptService)
  })

  describe('create', () => {
    it('should create a prompt with an auto-assigned orderKey and seed v1', async () => {
      const result = await promptService.create({ title: 'T1', content: 'C1' })

      expect(result).toMatchObject({ title: 'T1', content: 'C1', currentVersion: 1, variables: null })

      const [row] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, result.id))
      expect(row.orderKey.length).toBeGreaterThan(0)
      expect(row.content).toBe('C1')

      const versions = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, result.id))
      expect(versions).toHaveLength(1)
      expect(versions[0]).toMatchObject({ version: 1, content: 'C1', rollbackFrom: null })
    })

    it('should persist variables on the initial version snapshot', async () => {
      const variables = [{ id: 'v1', key: 'name', type: 'input' as const, placeholder: 'Your name' }]
      const result = await promptService.create({ title: 'Greeting', content: 'Hi ${name}', variables })

      expect(result.variables).toEqual(variables)

      const [version] = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, result.id))
      expect(JSON.parse(version.variables!)).toEqual(variables)
    })

    it('should assign strictly increasing orderKeys on successive creates', async () => {
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
      await expect(promptService.getById(p.id)).resolves.toMatchObject({ id: p.id })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.getById(PROMPT_ID_MISSING)).rejects.toBeInstanceOf(DataApiError)
      await expect(promptService.getById(PROMPT_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('update — content change creates a new version', () => {
    it('should bump currentVersion and append a new prompt_version row', async () => {
      const p = await seedPrompt('title', 'original')

      const updated = await promptService.update(p.id, { content: 'edited' })

      expect(updated).toMatchObject({ content: 'edited', currentVersion: 2 })

      const versions = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(eq(promptVersionTable.promptId, p.id))
        .orderBy(asc(promptVersionTable.version))
      expect(versions).toHaveLength(2)
      expect(versions[1]).toMatchObject({ version: 2, content: 'edited', rollbackFrom: null })
    })

    it('should leave the prior version row untouched (append-only history)', async () => {
      const p = await seedPrompt('title', 'original')
      const [v1Before] = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, p.id), eq(promptVersionTable.version, 1)))

      await promptService.update(p.id, { content: 'edited' })

      const [v1After] = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, p.id), eq(promptVersionTable.version, 1)))
      expect(v1After).toEqual(v1Before)
    })

    it('should snapshot existing variables when the DTO omits variables', async () => {
      const variables = [{ id: 'v1', key: 'name', type: 'input' as const }]
      const p = await promptService.create({ title: 't', content: 'hi ${name}', variables })

      await promptService.update(p.id, { content: 'bye ${name}' })

      const [v2] = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, p.id), eq(promptVersionTable.version, 2)))
      expect(JSON.parse(v2.variables!)).toEqual(variables)
    })

    it('should use the DTO variables for the new snapshot when provided', async () => {
      const p = await promptService.create({
        title: 't',
        content: 'hi ${name}',
        variables: [{ id: 'v1', key: 'name', type: 'input' }]
      })
      const next = [{ id: 'v2', key: 'lang', type: 'select' as const, options: ['en', 'zh'] }]

      await promptService.update(p.id, { content: 'hi ${lang}', variables: next })

      const [v2] = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(and(eq(promptVersionTable.promptId, p.id), eq(promptVersionTable.version, 2)))
      expect(JSON.parse(v2.variables!)).toEqual(next)
    })
  })

  describe('update — variables-only change updates current version in place', () => {
    it('should not create a new prompt_version row', async () => {
      const p = await seedPrompt('title', 'body')
      const before = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, p.id))
      const next = [{ id: 'v1', key: 'x', type: 'input' as const }]

      const updated = await promptService.update(p.id, { variables: next })

      expect(updated.currentVersion).toBe(1)
      expect(updated.variables).toEqual(next)
      const after = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, p.id))
      expect(after).toHaveLength(before.length)
      expect(JSON.parse(after[0].variables!)).toEqual(next)
    })
  })

  describe('update — same content creates no version', () => {
    it('should be a no-op on prompt_version when content is unchanged', async () => {
      const p = await seedPrompt('title', 'body')

      await promptService.update(p.id, { title: 'renamed', content: 'body' })

      const versions = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, p.id))
      expect(versions).toHaveLength(1)
      const [row] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(row.title).toBe('renamed')
      expect(row.currentVersion).toBe(1)
    })
  })

  describe('update — error paths', () => {
    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.update(PROMPT_ID_MISSING, { title: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should return the existing prompt unchanged when every field is undefined', async () => {
      const p = await seedPrompt()
      const before = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))

      const result = await promptService.update(p.id, {})

      expect(result.id).toBe(p.id)
      const after = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(after[0]).toEqual(before[0])
    })
  })

  describe('rollback', () => {
    it('should append a new version carrying the target snapshot (append-only)', async () => {
      const p = await seedPrompt('t', 'v1 body')
      await promptService.update(p.id, { content: 'v2 body' })
      await promptService.update(p.id, { content: 'v3 body' })

      const rolled = await promptService.rollback(p.id, { version: 1 })

      expect(rolled).toMatchObject({ content: 'v1 body', currentVersion: 4 })

      const versions = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(eq(promptVersionTable.promptId, p.id))
        .orderBy(asc(promptVersionTable.version))
      expect(versions).toHaveLength(4)
      expect(versions[3]).toMatchObject({ version: 4, content: 'v1 body', rollbackFrom: 1 })
    })

    it('should not UPDATE any prior version row', async () => {
      const p = await seedPrompt('t', 'v1 body')
      await promptService.update(p.id, { content: 'v2 body' })
      const priorVersions = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(eq(promptVersionTable.promptId, p.id))
        .orderBy(asc(promptVersionTable.version))

      await promptService.rollback(p.id, { version: 1 })

      const afterVersions = await dbh.db
        .select()
        .from(promptVersionTable)
        .where(eq(promptVersionTable.promptId, p.id))
        .orderBy(asc(promptVersionTable.version))
      for (let i = 0; i < priorVersions.length; i++) {
        expect(afterVersions[i]).toEqual(priorVersions[i])
      }
    })

    it('should propagate the target version variables (not current variables)', async () => {
      const v1Vars = [{ id: 'v1', key: 'name', type: 'input' as const }]
      const p = await promptService.create({ title: 't', content: 'hi ${name}', variables: v1Vars })
      const v2Vars = [{ id: 'v2', key: 'other', type: 'input' as const }]
      await promptService.update(p.id, { content: 'hi ${other}', variables: v2Vars })

      const rolled = await promptService.rollback(p.id, { version: 1 })
      expect(rolled.variables).toEqual(v1Vars)
    })

    it('should throw NOT_FOUND when the target version does not exist', async () => {
      const p = await seedPrompt()
      await expect(promptService.rollback(p.id, { version: 99 })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.rollback(PROMPT_ID_MISSING, { version: 1 })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('getVersions', () => {
    it('should return versions ordered newest first', async () => {
      const p = await seedPrompt('t', 'v1')
      await promptService.update(p.id, { content: 'v2' })
      await promptService.update(p.id, { content: 'v3' })

      const versions = await promptService.getVersions(p.id)
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1])
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      await expect(promptService.getVersions(PROMPT_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('delete', () => {
    it('should cascade-delete version rows', async () => {
      const p = await seedPrompt('t', 'v1')
      await promptService.update(p.id, { content: 'v2' })

      await promptService.delete(p.id)

      const prompts = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      const versions = await dbh.db.select().from(promptVersionTable).where(eq(promptVersionTable.promptId, p.id))
      expect(prompts).toHaveLength(0)
      expect(versions).toHaveLength(0)
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

    it('should throw NOT_FOUND when the after anchor does not exist', async () => {
      const a = await seedPrompt('a', 'a')
      await expect(promptService.reorder(a.id, { after: PROMPT_ID_MISSING })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should touch only the target row (catch transposition bugs)', async () => {
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

  describe('safeParseVariables corruption handling', () => {
    it('should fall back to null when the DB row carries malformed JSON', async () => {
      const p = await seedPrompt('t', 'c')
      // Directly corrupt the persisted variables JSON to simulate schema drift / data rot.
      await dbh.db.update(promptTable).set({ variables: '{ not valid json' }).where(eq(promptTable.id, p.id))

      const result = await promptService.getById(p.id)
      expect(result.variables).toBeNull()
    })

    it('should fall back to null when the DB row carries schema-invalid variables', async () => {
      const p = await seedPrompt('t', 'c')
      await dbh.db
        .update(promptTable)
        .set({ variables: JSON.stringify([{ id: '', key: '', type: 'input' }]) })
        .where(eq(promptTable.id, p.id))

      const result = await promptService.getById(p.id)
      expect(result.variables).toBeNull()
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
