import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiError, DataApiErrorFactory } from '@shared/data/api/errors'

/**
 * Exercises the knowledge routes through a wrapper app that includes the real
 * Cherry REST `restErrorHandler` (the dialect these endpoints use), so the full
 * chain runs: v2 data services → route logic → response schemas → REST error
 * shaping (DataApiError → `{ error: { code, message } }` with its HTTP status).
 */

const {
  mockList,
  mockGetById,
  mockListItems,
  mockGetItemById,
  mockSearch,
  mockCreateBase,
  mockDeleteBase,
  mockAddItems,
  mockDeleteItems,
  mockReindexItems
} = vi.hoisted(() => ({
  mockList: vi.fn<(query: unknown) => unknown>(),
  mockGetById: vi.fn<(id: string) => unknown>(),
  mockListItems: vi.fn<(baseId: string, query: unknown) => unknown>(),
  mockGetItemById: vi.fn<(id: string) => unknown>(),
  mockSearch: vi.fn<(baseId: string, query: string) => Promise<unknown[]>>(),
  mockCreateBase: vi.fn<(input: unknown) => Promise<unknown>>(),
  mockDeleteBase: vi.fn<(baseId: string) => Promise<void>>(),
  mockAddItems: vi.fn<(baseId: string, items: unknown[]) => Promise<unknown>>(),
  mockDeleteItems: vi.fn<(baseId: string, itemIds: string[]) => Promise<void>>(),
  mockReindexItems: vi.fn<(baseId: string, itemIds: string[]) => Promise<void>>()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { list: mockList, getById: mockGetById }
}))
vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { list: mockListItems, getById: mockGetItemById }
}))
vi.mock('@application', () => ({
  application: {
    get: vi.fn(() => ({
      search: mockSearch,
      createBase: mockCreateBase,
      deleteBase: mockDeleteBase,
      addItems: mockAddItems,
      deleteItems: mockDeleteItems,
      reindexItems: mockReindexItems
    }))
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }
}))

import { restErrorHandler } from '../../errors'
import { knowledgeRoutes } from '../knowledge'

const app = new Elysia().error({ DATA_API: DataApiError }).onError(restErrorHandler).use(knowledgeRoutes)

const kb = (id: string, name: string) => ({
  id,
  name,
  embeddingModelId: 'openai:text-embedding-3-small',
  dimensions: 1536
})
const result = (chunkId: string, score: number) => ({
  pageContent: `chunk ${chunkId}`,
  score,
  scoreKind: 'similarity',
  rank: 1,
  metadata: {},
  chunkId
})

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  )
  return { status: res.status, body: await res.json() }
}

describe('knowledge routes (v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetItemById.mockReturnValue({ id: 'note-1', baseId: 'kb-1' })
  })

  it('GET /knowledge-bases applies a true offset/limit window', async () => {
    // The service is page-based; the route fetches [0, offset+limit) from page 1
    // and slices the exact window, so page-aligned offsets still work end-to-end.
    const items = Array.from({ length: 40 }, (_, i) => kb(`kb-${i}`, `KB ${i}`))
    mockList.mockReturnValue({ items, total: 100, page: 1 })
    const { status, body } = await call('GET', '/knowledge-bases?limit=20&offset=20')
    expect(status).toBe(200)
    expect(mockList).toHaveBeenCalledWith({ page: 1, limit: 40 })
    expect(body.knowledge_bases).toHaveLength(20)
    expect(body.knowledge_bases[0].id).toBe('kb-20')
    expect(body.knowledge_bases[19].id).toBe('kb-39')
    expect(body.total).toBe(100)
  })

  it('GET /knowledge-bases honors a non-page-aligned offset (v1 regression guard)', async () => {
    // offset=5, limit=20 → must return items 5..24 (the v1 server sliced; the first
    // port floored to a page and returned 0..19, dropping the offset%limit remainder).
    const items = Array.from({ length: 25 }, (_, i) => kb(`kb-${i}`, `KB ${i}`))
    mockList.mockReturnValue({ items, total: 25, page: 1 })
    const { status, body } = await call('GET', '/knowledge-bases?limit=20&offset=5')
    expect(status).toBe(200)
    expect(mockList).toHaveBeenCalledWith({ page: 1, limit: 25 })
    expect(body.knowledge_bases).toHaveLength(20)
    expect(body.knowledge_bases[0].id).toBe('kb-5')
    expect(body.knowledge_bases[19].id).toBe('kb-24')
  })

  it('GET /knowledge-bases/:id returns a base', async () => {
    mockGetById.mockReturnValue(kb('kb-1', 'KB 1'))
    const { status, body } = await call('GET', '/knowledge-bases/kb-1')
    expect(status).toBe(200)
    expect(body.id).toBe('kb-1')
  })

  it('POST /knowledge-bases creates a BM25-only base through KnowledgeService', async () => {
    mockCreateBase.mockResolvedValue(kb('kb-new', 'Imported notes'))

    const { status, body } = await call('POST', '/knowledge-bases', { name: 'Imported notes' })

    expect(status).toBe(201)
    expect(mockCreateBase).toHaveBeenCalledWith({
      name: 'Imported notes',
      embeddingModelId: undefined,
      dimensions: undefined
    })
    expect(body.id).toBe('kb-new')
  })

  it('POST /knowledge-bases rejects a half-configured embedding model pair', async () => {
    const { status } = await call('POST', '/knowledge-bases', {
      name: 'Invalid',
      embedding_model_id: 'provider::embed'
    })

    expect(status).toBe(422)
    expect(mockCreateBase).not.toHaveBeenCalled()
  })

  it('GET /knowledge-bases/:id/documents returns bounded metadata without document content', async () => {
    mockListItems.mockReturnValue({
      items: [
        {
          id: 'note-1',
          baseId: 'kb-1',
          type: 'note',
          status: 'completed',
          groupId: null,
          data: { source: 'joplin:42', content: 'private document body' },
          error: null
        }
      ],
      total: 101,
      nextCursor: 'cursor-2'
    })

    const { status, body } = await call('GET', '/knowledge-bases/kb-1/documents?limit=1&cursor=cursor-1')

    expect(status).toBe(200)
    expect(mockListItems).toHaveBeenCalledWith('kb-1', { limit: 1, cursor: 'cursor-1' })
    expect(body).toEqual({
      documents: [
        {
          id: 'note-1',
          type: 'note',
          status: 'completed',
          group_id: null,
          source: 'joplin:42',
          error: null
        }
      ],
      total: 101,
      next_cursor: 'cursor-2'
    })
  })

  it('POST /knowledge-bases/:id/documents adds raw text through the durable workflow', async () => {
    mockAddItems.mockResolvedValue({ status: 'added' })

    const { status, body } = await call('POST', '/knowledge-bases/kb-1/documents', {
      documents: [{ title: 'joplin:42', content: '# Updated', group_id: 'folder-1' }]
    })

    expect(status).toBe(200)
    expect(mockAddItems).toHaveBeenCalledWith(
      'kb-1',
      [{ type: 'note', groupId: 'folder-1', data: { source: 'joplin:42', content: '# Updated' } }],
      'rename'
    )
    expect(body).toEqual({ status: 'added' })
  })

  it('POST /knowledge-bases/:id/documents rejects an oversized UTF-8 aggregate', async () => {
    const { status } = await call('POST', '/knowledge-bases/kb-1/documents', {
      documents: Array.from({ length: 11 }, (_, index) => ({
        title: `note-${index}`,
        content: '中'.repeat(333_334)
      }))
    })

    expect(status).toBe(422)
    expect(mockAddItems).not.toHaveBeenCalled()
  })

  it('DELETE /knowledge-bases/:id/documents/:documentId delegates subtree deletion', async () => {
    const { status, body } = await call('DELETE', '/knowledge-bases/kb-1/documents/note-1')

    expect(status).toBe(202)
    expect(mockDeleteItems).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(body).toEqual({ status: 'queued' })
  })

  it('POST /knowledge-bases/:id/documents/:documentId/reindex delegates durable reindexing', async () => {
    const { status, body } = await call('POST', '/knowledge-bases/kb-1/documents/note-1/reindex')

    expect(status).toBe(202)
    expect(mockReindexItems).toHaveBeenCalledWith('kb-1', ['note-1'])
    expect(body).toEqual({ status: 'queued' })
  })

  it('rejects document operations when the document belongs to another knowledge base', async () => {
    mockGetItemById.mockReturnValue({ id: 'note-1', baseId: 'kb-2' })

    const deletion = await call('DELETE', '/knowledge-bases/kb-1/documents/note-1')
    const reindex = await call('POST', '/knowledge-bases/kb-1/documents/note-1/reindex')

    expect(deletion.status).toBe(404)
    expect(reindex.status).toBe(404)
    expect(mockDeleteItems).not.toHaveBeenCalled()
    expect(mockReindexItems).not.toHaveBeenCalled()
  })

  it('DELETE /knowledge-bases/:id delegates base and artifact cleanup', async () => {
    const { status, body } = await call('DELETE', '/knowledge-bases/kb-1')

    expect(status).toBe(200)
    expect(mockDeleteBase).toHaveBeenCalledWith('kb-1')
    expect(body).toEqual({ deleted: true })
  })

  it('GET /knowledge-bases/:id maps a DataApiError NOT_FOUND → 404 REST envelope', async () => {
    mockGetById.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('KnowledgeBase', 'nope')
    })
    const { status, body } = await call('GET', '/knowledge-bases/nope')
    expect(status).toBe(404)
    expect(body.type).toBeUndefined() // Cherry REST dialect: { error: { code, message } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('POST /search aggregates + sorts orchestrator results across bases', async () => {
    mockList.mockReturnValue({ items: [kb('kb-1', 'KB 1'), kb('kb-2', 'KB 2')], total: 2, page: 1 })
    mockSearch.mockImplementation(async (baseId: string) =>
      baseId === 'kb-1' ? [result('a', 0.4)] : [result('b', 0.9)]
    )
    const { status, body } = await call('POST', '/knowledge-bases/search', { query: 'hi' })
    expect(status).toBe(200)
    expect(body.results.map((r: any) => r.chunkId)).toEqual(['b', 'a'])
    expect(body.results[0].knowledge_base_id).toBe('kb-2')
  })

  it('POST /search warns when no knowledge bases are configured', async () => {
    mockList.mockReturnValue({ items: [], total: 0, page: 1 })
    const { status, body } = await call('POST', '/knowledge-bases/search', { query: 'hi' })
    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.warnings).toHaveLength(1)
  })

  it('POST /search → 503 when every targeted base search fails', async () => {
    mockList.mockReturnValue({ items: [kb('kb-1', 'KB 1'), kb('kb-2', 'KB 2')], total: 2, page: 1 })
    mockSearch.mockRejectedValue(new Error('vector store unavailable'))
    const { status, body } = await call('POST', '/knowledge-bases/search', { query: 'hi' })
    expect(status).toBe(503)
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('POST /search → 404 when none of the specified bases exist', async () => {
    mockGetById.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('KnowledgeBase', 'nope')
    })
    const { status, body } = await call('POST', '/knowledge-bases/search', {
      query: 'hi',
      knowledge_base_ids: ['nope']
    })
    expect(status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('POST /search propagates a non-NOT_FOUND getById failure instead of masking it as 404', async () => {
    mockGetById.mockImplementation(() => {
      throw new Error('database unavailable')
    })
    const { status, body } = await call('POST', '/knowledge-bases/search', {
      query: 'hi',
      knowledge_base_ids: ['kb-1']
    })
    expect(status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })
})
