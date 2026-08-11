import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import { PromptService, promptService } from '@data/services/PromptService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PROMPT_ID_MISSING = '11111111-1111-4111-8111-111111111111'
const ASSISTANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ASSISTANT_ID = '33333333-3333-4333-8333-333333333333'
const AGENT_ID = 'legacy-agent-id'

async function seedPrompt(title = 'Hello', content = 'Prompt body') {
  return promptService.create({ title, content })
}

describe('PromptService', () => {
  const dbh = setupTestDatabase()

  async function seedAssistant(id: string, orderKey: string) {
    await dbh.db.insert(assistantTable).values({
      id,
      name: `Assistant ${id}`,
      emoji: '🌟',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey
    })
  }

  async function seedAgent() {
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Agent',
      instructions: 'Help',
      orderKey: 'a0'
    })
  }

  it('should export a module-level singleton of PromptService', () => {
    expect(promptService).toBeInstanceOf(PromptService)
  })

  describe('create', () => {
    it('should create a prompt with title, content, timestamps, and an order key', async () => {
      const result = promptService.create({ title: 'T1', content: 'C1' })

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
      const a = promptService.create({ title: 'A', content: 'a' })
      const b = promptService.create({ title: 'B', content: 'b' })
      const c = promptService.create({ title: 'C', content: 'c' })

      const rows = await dbh.db.select().from(promptTable).orderBy(asc(promptTable.orderKey))
      expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id])
    })

    it('should atomically create a global prompt and its initial Assistant binding', async () => {
      await seedAssistant(ASSISTANT_ID, 'a0')

      const result = promptService.create({
        title: 'Bound',
        content: 'Assistant prompt',
        bindingTarget: { type: 'assistant', id: ASSISTANT_ID }
      })

      expect(promptService.list()).toEqual([result])
      expect(promptService.list({ targetType: 'assistant', targetId: ASSISTANT_ID })).toEqual([result])
      const bindings = await dbh.db.select().from(promptBindingTable)
      expect(bindings).toHaveLength(1)
      expect(bindings[0]).toMatchObject({
        promptId: result.id,
        targetType: 'assistant',
        targetId: ASSISTANT_ID
      })
    })

    it('should roll back prompt creation when the binding target does not exist', () => {
      expect(() =>
        promptService.create({
          title: 'Orphan',
          content: 'Must not persist',
          bindingTarget: { type: 'assistant', id: ASSISTANT_ID }
        })
      ).toThrow(DataApiError)

      expect(promptService.list()).toEqual([])
    })
  })

  describe('list', () => {
    it('should return prompts ordered by orderKey', async () => {
      const a = await seedPrompt('A', 'a')
      const b = await seedPrompt('B', 'b')

      const all = promptService.list()
      expect(all.map((p) => p.id)).toEqual([a.id, b.id])
    })

    it('should return an empty array when no prompts exist', async () => {
      expect(promptService.list()).toEqual([])
    })

    it('should filter by search on title', async () => {
      await seedPrompt('Daily Report', 'body')
      await seedPrompt('Meeting Notes', 'body')

      const all = promptService.list({ search: 'daily' })
      expect(all.map((p) => p.title)).toEqual(['Daily Report'])
    })

    it('should filter by search on content', async () => {
      await seedPrompt('A', 'Summarize unread email')
      await seedPrompt('B', 'Draft changelog')

      const all = promptService.list({ search: 'email' })
      expect(all.map((p) => p.title)).toEqual(['A'])
    })

    it('should treat %/_ in search as literals, not wildcards', async () => {
      await seedPrompt('percent_100', 'exact')
      await seedPrompt('noMatch', 'exact')

      const underscore = promptService.list({ search: 'percent_' })
      expect(underscore.map((p) => p.title)).toEqual(['percent_100'])

      const literalMiss = promptService.list({ search: '_Match' })
      expect(literalMiss).toHaveLength(0)
    })

    it('should filter prompts by Assistant or Agent binding at the query layer', async () => {
      await seedAssistant(ASSISTANT_ID, 'a0')
      await seedAssistant(OTHER_ASSISTANT_ID, 'a1')
      await seedAgent()
      const assistantPrompt = await seedPrompt('Assistant', 'assistant only')
      const agentPrompt = await seedPrompt('Agent', 'agent only')
      const unboundPrompt = await seedPrompt('Global', 'unbound')

      promptService.bindToTarget(assistantPrompt.id, { type: 'assistant', id: ASSISTANT_ID })
      promptService.bindToTarget(agentPrompt.id, { type: 'agent', id: AGENT_ID })

      expect(promptService.list({ targetType: 'assistant', targetId: ASSISTANT_ID })).toEqual([assistantPrompt])
      expect(promptService.list({ targetType: 'assistant', targetId: OTHER_ASSISTANT_ID })).toEqual([])
      expect(promptService.list({ targetType: 'agent', targetId: AGENT_ID })).toEqual([agentPrompt])
      expect(promptService.list().map((prompt) => prompt.id)).toEqual([
        assistantPrompt.id,
        agentPrompt.id,
        unboundPrompt.id
      ])
    })
  })

  describe('bindings', () => {
    it('should bind and unbind idempotently', async () => {
      await seedAssistant(ASSISTANT_ID, 'a0')
      const prompt = await seedPrompt()
      const target = { type: 'assistant' as const, id: ASSISTANT_ID }

      promptService.bindToTarget(prompt.id, target)
      promptService.bindToTarget(prompt.id, target)
      expect(await dbh.db.select().from(promptBindingTable)).toHaveLength(1)

      promptService.unbindFromTarget(prompt.id, target)
      promptService.unbindFromTarget(prompt.id, target)
      expect(await dbh.db.select().from(promptBindingTable)).toHaveLength(0)
      expect(promptService.getById(prompt.id)).toMatchObject({ id: prompt.id })
    })

    it('should reject a missing prompt or target', async () => {
      await seedAssistant(ASSISTANT_ID, 'a0')
      const prompt = await seedPrompt()

      expect(() => promptService.bindToTarget(PROMPT_ID_MISSING, { type: 'assistant', id: ASSISTANT_ID })).toThrow(
        DataApiError
      )
      expect(() => promptService.bindToTarget(prompt.id, { type: 'assistant', id: OTHER_ASSISTANT_ID })).toThrow(
        DataApiError
      )
    })
  })

  describe('getById', () => {
    it('should return the prompt when found', async () => {
      const p = await seedPrompt()
      expect(promptService.getById(p.id)).toMatchObject({ id: p.id, title: p.title, content: p.content })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      expect(() => promptService.getById(PROMPT_ID_MISSING)).toThrow(DataApiError)
      let err: unknown
      try {
        promptService.getById(PROMPT_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('update', () => {
    it('should update title and content in place', async () => {
      const p = await seedPrompt('title', 'original')

      const updated = promptService.update(p.id, { title: 'renamed', content: 'edited' })

      expect(updated).toMatchObject({ id: p.id, title: 'renamed', content: 'edited' })
      const [row] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(row).toMatchObject({ title: 'renamed', content: 'edited' })
    })

    it('should support partial updates', async () => {
      const p = await seedPrompt('title', 'body')

      expect(promptService.update(p.id, { title: 'renamed' })).toMatchObject({
        title: 'renamed',
        content: 'body'
      })
      expect(promptService.update(p.id, { content: 'updated' })).toMatchObject({
        title: 'renamed',
        content: 'updated'
      })
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      let err: unknown
      try {
        promptService.update(PROMPT_ID_MISSING, { title: 'x' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('delete', () => {
    it('should delete the prompt row', async () => {
      const p = await seedPrompt('t', 'v1')

      promptService.delete(p.id)

      const prompts = await dbh.db.select().from(promptTable).where(eq(promptTable.id, p.id))
      expect(prompts).toHaveLength(0)
    })

    it('should cascade-delete prompt bindings', async () => {
      await seedAssistant(ASSISTANT_ID, 'a0')
      const prompt = promptService.create({
        title: 'Bound',
        content: 'Body',
        bindingTarget: { type: 'assistant', id: ASSISTANT_ID }
      })

      promptService.delete(prompt.id)

      expect(await dbh.db.select().from(promptBindingTable)).toHaveLength(0)
    })

    it('should throw NOT_FOUND when the prompt does not exist', async () => {
      let err: unknown
      try {
        promptService.delete(PROMPT_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('reorder', () => {
    it("should move a prompt to the first position via { position: 'first' }", async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      promptService.reorder(c.id, { position: 'first' })

      const ids = promptService.list().map((p) => p.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('should move a prompt to before an anchor', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      promptService.reorder(c.id, { before: b.id })

      const ids = promptService.list().map((p) => p.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should throw NOT_FOUND when the target does not exist', async () => {
      let err: unknown
      try {
        promptService.reorder(PROMPT_ID_MISSING, { position: 'first' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('should throw NOT_FOUND when the before anchor does not exist', async () => {
      const a = await seedPrompt('a', 'a')
      let err: unknown
      try {
        promptService.reorder(a.id, { before: PROMPT_ID_MISSING })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('should touch only the target row', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')
      const c = await seedPrompt('c', 'c')

      const [aBefore] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, a.id))
      const [bBefore] = await dbh.db.select().from(promptTable).where(eq(promptTable.id, b.id))

      promptService.reorder(c.id, { position: 'first' })

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

      promptService.reorderBatch([
        { id: c.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'last' } }
      ])

      const ids = promptService.list().map((p) => p.id)
      expect(ids).toEqual([c.id, b.id, a.id])
    })

    it('should throw NOT_FOUND when a move references a missing anchor', async () => {
      const a = await seedPrompt('a', 'a')
      const b = await seedPrompt('b', 'b')

      let err: unknown
      try {
        promptService.reorderBatch([
          { id: a.id, anchor: { position: 'first' } },
          { id: b.id, anchor: { before: PROMPT_ID_MISSING } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })
})
