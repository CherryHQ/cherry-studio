import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// `@logger` is mocked globally in `tests/main.setup.ts` via the unified
// MockMainLoggerService singleton. runWithBusyRetry's retry +
// retry-exhausted observations land on this shared `warn` spy regardless
// of which `withContext(name)` produced the logger.
const mockLoggerWarn = mockMainLoggerService.warn

const {
  chatMessageChecker,
  createDefaultOrphanCheckerRegistry,
  knowledgeItemChecker,
  orphanCheckerRegistry,
  paintingChecker,
  tempSessionChecker
} = await import('../orphanCheckerRegistry')

import type { OrphanCheckerRegistry } from '../orphanCheckerRegistry'

describe('orphanCheckerRegistry', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    mockLoggerWarn.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        embeddingModelId: null,
        dimensions: 1024,
        status: 'failed',
        error: 'missing_embedding_model',
        chunkSize: 1024,
        chunkOverlap: 200,
        searchMode: 'vector'
      })
    }

    async function seedItem(id: string) {
      await dbh.db.insert(knowledgeItemTable).values({
        id,
        baseId: 'kb-orphan-test',
        type: 'note',
        data: { source: 's', content: 'c' },
        status: 'idle',
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

  describe('painting checker', () => {
    async function seedPainting(id: string) {
      await dbh.db.insert(paintingTable).values({
        id,
        providerId: 'aihubmix',
        prompt: 'p',
        orderKey: id
      })
    }

    it('returns the subset of painting ids that exist', async () => {
      await seedPainting('pt-alive-1')
      await seedPainting('pt-alive-2')

      const alive = await paintingChecker.checkExists(['pt-alive-1', 'pt-alive-2', 'pt-gone'])
      expect(alive).toEqual(new Set(['pt-alive-1', 'pt-alive-2']))
    })

    it('returns empty set for an empty input (skips DB round-trip)', async () => {
      const alive = await paintingChecker.checkExists([])
      expect(alive.size).toBe(0)
    })

    it('declares its sourceType', () => {
      expect(paintingChecker.sourceType).toBe('painting')
    })
  })

  describe('knowledge_item checker runWithBusyRetry behaviour', () => {
    // Test the file-private runWithBusyRetry indirectly via its only call site
    // (knowledgeItemChecker.checkExists). The DB is a real test SQLite instance,
    // so we spy on the first .select() call to throw a synthetic SQLITE_BUSY —
    // drizzle propagates the throw out of the chain and runWithBusyRetry's
    // outer catch sees it. Subsequent select() calls fall through to the real
    // implementation, exercising the retry branch with a real query.
    function makeSqliteError(code: string, message = 'synthetic'): Error {
      return Object.assign(new Error(message), { code })
    }

    async function seedOne(id: string) {
      await dbh.db.insert(knowledgeBaseTable).values({
        id: 'kb-retry-test',
        name: 'KB',
        embeddingModelId: null,
        dimensions: 1024,
        status: 'failed',
        error: 'missing_embedding_model',
        chunkSize: 1024,
        chunkOverlap: 200,
        searchMode: 'vector'
      })
      await dbh.db.insert(knowledgeItemTable).values({
        id,
        baseId: 'kb-retry-test',
        type: 'note',
        data: { source: 's', content: 'c' },
        status: 'idle',
        error: null
      })
    }

    it('first SQLITE_BUSY then success: logs "retrying once" and returns the retry result', async () => {
      await seedOne('ki-retry-ok')
      let callCount = 0
      const realSelect = dbh.db.select.bind(dbh.db)
      vi.spyOn(dbh.db, 'select').mockImplementation(((...args: unknown[]) => {
        callCount++
        if (callCount === 1) throw makeSqliteError('SQLITE_BUSY', 'database is locked')
        return (realSelect as (...args: unknown[]) => unknown)(...args)
      }) as typeof dbh.db.select)

      const alive = await knowledgeItemChecker.checkExists(['ki-retry-ok', 'ki-missing'])

      expect(alive).toEqual(new Set(['ki-retry-ok']))
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'orphan-sweep: SQLITE_BUSY, retrying once',
        expect.objectContaining({ delayMs: expect.any(Number) })
      )
    })

    it('persistent SQLITE_BUSY: logs both "retrying" and retry-exhausted, rethrows', async () => {
      await seedOne('ki-busy-busy')
      const busyErr = makeSqliteError('SQLITE_BUSY', 'database is locked')
      vi.spyOn(dbh.db, 'select').mockImplementation((() => {
        throw busyErr
      }) as typeof dbh.db.select)

      await expect(knowledgeItemChecker.checkExists(['ki-busy-busy'])).rejects.toBe(busyErr)

      expect(mockLoggerWarn).toHaveBeenCalledTimes(2)
      expect(mockLoggerWarn).toHaveBeenNthCalledWith(
        1,
        'orphan-sweep: SQLITE_BUSY, retrying once',
        expect.objectContaining({ delayMs: expect.any(Number) })
      )
      expect(mockLoggerWarn).toHaveBeenNthCalledWith(
        2,
        'orphan-sweep: retry attempt also failed; surfacing as failure',
        expect.objectContaining({
          code: 'SQLITE_BUSY',
          err: busyErr
        })
      )
    })

    it('SQLITE_BUSY then a different error: logs retry-exhausted with the new error code', async () => {
      // Regression guard for T3 (commit 32a22f364): the previous gating on
      // `retryErr.code === 'SQLITE_BUSY'` silently rethrew SQLITE_CORRUPT /
      // SQLITE_IOERR / driver TypeErrors from the second attempt, hiding the
      // "we already retried" signal. The code field must surface the actual
      // failure mode, not the BUSY that triggered the retry.
      await seedOne('ki-busy-corrupt')
      const busyErr = makeSqliteError('SQLITE_BUSY')
      const corruptErr = makeSqliteError('SQLITE_CORRUPT', 'database disk image is malformed')
      let callCount = 0
      vi.spyOn(dbh.db, 'select').mockImplementation((() => {
        callCount++
        if (callCount === 1) throw busyErr
        throw corruptErr
      }) as typeof dbh.db.select)

      await expect(knowledgeItemChecker.checkExists(['ki-busy-corrupt'])).rejects.toBe(corruptErr)

      expect(mockLoggerWarn).toHaveBeenCalledTimes(2)
      expect(mockLoggerWarn).toHaveBeenNthCalledWith(
        2,
        'orphan-sweep: retry attempt also failed; surfacing as failure',
        expect.objectContaining({
          code: 'SQLITE_CORRUPT',
          err: corruptErr
        })
      )
    })

    it('non-SQLITE_BUSY first failure: rethrows without retry or logging', async () => {
      const corruptErr = makeSqliteError('SQLITE_CORRUPT')
      vi.spyOn(dbh.db, 'select').mockImplementation((() => {
        throw corruptErr
      }) as typeof dbh.db.select)

      await expect(knowledgeItemChecker.checkExists(['ki-x'])).rejects.toBe(corruptErr)
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    })
  })

  describe('chat_message checker', () => {
    async function seedTopic(id: string) {
      await dbh.db.insert(topicTable).values({
        id,
        name: 'Test',
        isNameManuallyEdited: false,
        assistantId: null,
        activeNodeId: null,
        groupId: null,
        orderKey: 'a0',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }

    async function seedMessage(id: string, topicId: string) {
      await dbh.db.insert(messageTable).values({
        id,
        parentId: null,
        topicId,
        role: 'user',
        data: { parts: [] },
        searchableText: '',
        status: 'success',
        siblingsGroupId: 0,
        modelId: null,
        modelSnapshot: null,
        stats: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }

    it('returns the subset of message ids that exist', async () => {
      await seedTopic('t-checker')
      await seedMessage('m-alive-1', 't-checker')
      await seedMessage('m-alive-2', 't-checker')

      const alive = await chatMessageChecker.checkExists(['m-alive-1', 'm-alive-2', 'm-gone'])
      expect(alive).toEqual(new Set(['m-alive-1', 'm-alive-2']))
    })

    it('returns empty set for an empty input', async () => {
      const alive = await chatMessageChecker.checkExists([])
      expect(alive.size).toBe(0)
    })

    it('declares its sourceType', () => {
      expect(chatMessageChecker.sourceType).toBe('chat_message')
    })

    it('chunks queries past the SQLite IN-list cap', async () => {
      await seedTopic('t-bulk')
      const aliveIds = Array.from({ length: 1200 }, (_, i) => `m-bulk-${String(i).padStart(4, '0')}`)
      const SEED_CHUNK = 200
      for (let i = 0; i < aliveIds.length; i += SEED_CHUNK) {
        const slice = aliveIds.slice(i, i + SEED_CHUNK)
        await dbh.db.insert(messageTable).values(
          slice.map((id) => ({
            id,
            parentId: null,
            topicId: 't-bulk',
            role: 'user' as const,
            data: { parts: [] },
            searchableText: '',
            status: 'success' as const,
            siblingsGroupId: 0,
            modelId: null,
            modelSnapshot: null,
            stats: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }))
        )
      }

      const alive = await chatMessageChecker.checkExists([...aliveIds, 'm-not-real'])
      expect(alive.size).toBe(1200)
      expect(alive.has('m-bulk-0000')).toBe(true)
      expect(alive.has('m-bulk-0500')).toBe(true)
      expect(alive.has('m-bulk-1199')).toBe(true)
      expect(alive.has('m-not-real')).toBe(false)
    })
  })

  describe('registry exhaustiveness', () => {
    it('createDefaultOrphanCheckerRegistry includes chat_message', () => {
      const registry = createDefaultOrphanCheckerRegistry()
      expect(registry).toHaveProperty('chat_message')
      expect(registry.chat_message.sourceType).toBe('chat_message')
    })
  })

  describe('createDefaultOrphanCheckerRegistry / orphanCheckerRegistry', () => {
    it('exposes a checker for every FileRefSourceType', () => {
      const registry = createDefaultOrphanCheckerRegistry()
      const expected = ['temp_session', 'knowledge_item', 'chat_message', 'painting'] as const
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
      // @ts-expect-error — `knowledge_item` and `chat_message` are missing → TS2741
      const incomplete: OrphanCheckerRegistry = {
        temp_session: tempSessionChecker
        // knowledge_item: knowledgeItemChecker  ← intentionally omitted
        // chat_message: chatMessageChecker  ← intentionally omitted
      }
      expect(incomplete).toBeDefined()
    })

    it('rejects assigning a checker of the wrong sourceType brand', () => {
      const wrongBrand: OrphanCheckerRegistry = {
        // @ts-expect-error — knowledgeItemChecker is SourceTypeChecker<'knowledge_item'>,
        // not assignable to slot keyed 'temp_session'
        temp_session: knowledgeItemChecker,
        knowledge_item: knowledgeItemChecker,
        chat_message: chatMessageChecker,
        painting: paintingChecker
      }
      expect(wrongBrand).toBeDefined()
    })
  })
})
