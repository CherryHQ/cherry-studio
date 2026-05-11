import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { createDefaultOrphanCheckerRegistry, knowledgeItemChecker, orphanCheckerRegistry, tempSessionChecker } =
  await import('../FileRefCheckerRegistry')

import type { OrphanCheckerRegistry } from '../FileRefCheckerRegistry'

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
        error: 'missing_embedding_model',
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

    it('chunks queries past the SQLite IN-list cap and unions the results correctly', async () => {
      // SQLITE_INARRAY_CHUNK = 500; 1200 ids forces three chunks (500/500/200)
      // and exercises the union-across-chunks behavior. A bug that returns
      // only the first chunk's rows would fail this test.
      await seedKnowledgeBase()
      const aliveIds = Array.from({ length: 1200 }, (_, i) => `ki-bulk-${String(i).padStart(4, '0')}`)
      // Insert in batches so the seed itself doesn't blow up the SQLite limit.
      const SEED_CHUNK = 200
      for (let i = 0; i < aliveIds.length; i += SEED_CHUNK) {
        const slice = aliveIds.slice(i, i + SEED_CHUNK)
        await dbh.db.insert(knowledgeItemTable).values(
          slice.map((id) => ({
            id,
            baseId: 'kb-orphan-test',
            type: 'note' as const,
            data: { source: 's', content: 'c' },
            status: 'idle' as const,
            phase: null,
            error: null
          }))
        )
      }
      // Query against the same 1200 ids plus one ringer that doesn't exist.
      const alive = await knowledgeItemChecker.checkExists([...aliveIds, 'ki-not-real'])
      expect(alive.size).toBe(1200)
      expect(alive.has('ki-bulk-0000')).toBe(true) // first
      expect(alive.has('ki-bulk-0500')).toBe(true) // second-chunk boundary
      expect(alive.has('ki-bulk-1199')).toBe(true) // last
      expect(alive.has('ki-not-real')).toBe(false)
    })
  })

  describe('createDefaultOrphanCheckerRegistry / orphanCheckerRegistry', () => {
    it('exposes a checker for every FileRefSourceType', () => {
      const registry = createDefaultOrphanCheckerRegistry()
      const expected = ['temp_session', 'knowledge_item'] as const
      for (const sourceType of expected) {
        expect(registry[sourceType].sourceType).toBe(sourceType)
        expect(typeof registry[sourceType].checkExists).toBe('function')
      }
    })

    it('singleton wires the same checker instances', () => {
      expect(orphanCheckerRegistry.temp_session).toBe(tempSessionChecker)
      expect(orphanCheckerRegistry.knowledge_item).toBe(knowledgeItemChecker)
    })
  })

  /**
   * Type-level exhaustiveness — file-manager-architecture §7 exit criterion: "Adding a new
   * FileRefSourceType variant without a checker triggers a TS build error".
   *
   * The `@ts-expect-error` markers below MUST trigger TypeScript errors;
   * if a future refactor weakens the registry shape (e.g. drops the
   * Record<FileRefSourceType, ...> annotation), tsc will report the
   * comments as unused expectations and CI typecheck will fail — which is
   * exactly the signal we want.
   */
  describe('type-level exhaustiveness (file-manager-architecture §7 compile-time invariant)', () => {
    it('rejects a registry literal missing any FileRefSourceType key', () => {
      // @ts-expect-error — `knowledge_item` is missing → TS2741
      const incomplete: OrphanCheckerRegistry = {
        temp_session: tempSessionChecker
        // knowledge_item: knowledgeItemChecker  ← intentionally omitted
      }
      expect(incomplete).toBeDefined()
    })

    it('rejects assigning a checker of the wrong sourceType brand', () => {
      const wrongBrand: OrphanCheckerRegistry = {
        // @ts-expect-error — knowledgeItemChecker is SourceTypeChecker<'knowledge_item'>,
        // not assignable to slot keyed 'temp_session'
        temp_session: knowledgeItemChecker,
        knowledge_item: knowledgeItemChecker
      }
      expect(wrongBrand).toBeDefined()
    })
  })
})
