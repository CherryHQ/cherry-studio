import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const {
  chatMessageChecker,
  createDefaultOrphanCheckerRegistry,
  knowledgeItemChecker,
  noteChecker,
  orphanCheckerRegistry,
  paintingChecker,
  tempSessionChecker
} = await import('../FileRefCheckerRegistry')

describe('FileRefCheckerRegistry', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  describe('temp_session checker', () => {
    it('treats every sourceId as gone (sessions are in-memory only)', async () => {
      const alive = await tempSessionChecker.checkExists(['s1', 's2', 's3'])
      expect(alive).toBeInstanceOf(Set)
      expect(alive.size).toBe(0)
    })

    it('returns empty set even on empty input', async () => {
      const alive = await tempSessionChecker.checkExists([])
      expect(alive.size).toBe(0)
    })

    it('declares its sourceType', () => {
      expect(tempSessionChecker.sourceType).toBe('temp_session')
    })
  })

  describe('knowledge_item checker', () => {
    async function seedKnowledgeBase() {
      await dbh.db.insert(knowledgeBaseTable).values({
        id: 'kb-orphan-test',
        name: 'KB',
        emoji: '📁',
        embeddingModelId: null,
        dimensions: 1024,
        status: 'failed',
        error: 'seed-only',
        chunkSize: 1024,
        chunkOverlap: 200,
        searchMode: 'default'
      })
    }

    async function seedItem(id: string) {
      await dbh.db.insert(knowledgeItemTable).values({
        id,
        baseId: 'kb-orphan-test',
        type: 'note',
        data: { source: 's', content: 'c' },
        status: 'idle',
        phase: null,
        error: null
      })
    }

    it('returns the subset of knowledge_item ids that exist', async () => {
      await seedKnowledgeBase()
      await seedItem('ki-alive-1')
      await seedItem('ki-alive-2')

      const alive = await knowledgeItemChecker.checkExists(['ki-alive-1', 'ki-alive-2', 'ki-gone'])
      expect(alive).toEqual(new Set(['ki-alive-1', 'ki-alive-2']))
    })

    it('returns empty set for an empty input (skips DB round-trip)', async () => {
      const alive = await knowledgeItemChecker.checkExists([])
      expect(alive.size).toBe(0)
    })

    it('declares its sourceType', () => {
      expect(knowledgeItemChecker.sourceType).toBe('knowledge_item')
    })
  })

  describe('unmigrated source types (conservative no-op stubs)', () => {
    it.each([
      ['chat_message' as const, () => chatMessageChecker],
      ['painting' as const, () => paintingChecker],
      ['note' as const, () => noteChecker]
    ])('%s: returns every input id as alive (preserves all refs)', async (sourceType, getChecker) => {
      const checker = getChecker()
      expect(checker.sourceType).toBe(sourceType)
      const alive = await checker.checkExists(['x', 'y', 'z'])
      expect(alive).toEqual(new Set(['x', 'y', 'z']))
    })

    it.each([
      ['chat_message' as const, () => chatMessageChecker],
      ['painting' as const, () => paintingChecker],
      ['note' as const, () => noteChecker]
    ])('%s: empty input → empty output', async (_sourceType, getChecker) => {
      const alive = await getChecker().checkExists([])
      expect(alive.size).toBe(0)
    })
  })

  describe('createDefaultOrphanCheckerRegistry / orphanCheckerRegistry', () => {
    it('exposes a checker for every FileRefSourceType', () => {
      const registry = createDefaultOrphanCheckerRegistry()
      const expected = ['temp_session', 'chat_message', 'knowledge_item', 'painting', 'note'] as const
      for (const sourceType of expected) {
        expect(registry[sourceType].sourceType).toBe(sourceType)
        expect(typeof registry[sourceType].checkExists).toBe('function')
      }
    })

    it('singleton wires the same checker instances', () => {
      expect(orphanCheckerRegistry.temp_session).toBe(tempSessionChecker)
      expect(orphanCheckerRegistry.knowledge_item).toBe(knowledgeItemChecker)
      expect(orphanCheckerRegistry.chat_message).toBe(chatMessageChecker)
      expect(orphanCheckerRegistry.painting).toBe(paintingChecker)
      expect(orphanCheckerRegistry.note).toBe(noteChecker)
    })
  })
})
