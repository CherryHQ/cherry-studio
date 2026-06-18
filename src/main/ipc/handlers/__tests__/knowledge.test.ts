import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { knowledgeHandlers } from '../knowledge'

const knowledgeService = {
  createBase: vi.fn(),
  restoreBase: vi.fn(),
  deleteBase: vi.fn(),
  addItems: vi.fn(),
  deleteItems: vi.fn(),
  reindexItems: vi.fn(),
  search: vi.fn(),
  listItemChunks: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'KnowledgeService') return knowledgeService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Knowledge handlers ignore IpcContext (they act on shared business data, not the
// caller's window), so the senderId value is irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

type In<R extends keyof typeof knowledgeHandlers> = Parameters<(typeof knowledgeHandlers)[R]>[0]

describe('knowledgeHandlers', () => {
  it('create_base unwraps { base } and returns KnowledgeService.createBase result', async () => {
    const base = { name: 'KB', dimensions: 1536, embeddingModelId: 'm' }
    const created = { id: 'base-1' }
    knowledgeService.createBase.mockResolvedValue(created)

    const result = await knowledgeHandlers['knowledge.create_base']({ base }, ctx)

    expect(knowledgeService.createBase).toHaveBeenCalledWith(base)
    expect(result).toBe(created)
  })

  it('restore_base forwards the dto and returns the restored base', async () => {
    const dto = {
      sourceBaseId: 'src',
      name: 'KB',
      dimensions: 1536,
      embeddingModelId: 'm'
    } as In<'knowledge.restore_base'>
    const restored = { id: 'restored' }
    knowledgeService.restoreBase.mockResolvedValue(restored)

    const result = await knowledgeHandlers['knowledge.restore_base'](dto, ctx)

    expect(knowledgeService.restoreBase).toHaveBeenCalledWith(dto)
    expect(result).toBe(restored)
  })

  it('delete_base forwards baseId and resolves void', async () => {
    knowledgeService.deleteBase.mockResolvedValue(undefined)

    const result = await knowledgeHandlers['knowledge.delete_base']({ baseId: 'base-1' }, ctx)

    expect(knowledgeService.deleteBase).toHaveBeenCalledWith('base-1')
    expect(result).toBeUndefined()
  })

  it('add_items forwards baseId and items', async () => {
    const items = [{ type: 'note' as const, data: { source: 'manual', content: 'hello' } }]

    await knowledgeHandlers['knowledge.add_items']({ baseId: 'base-1', items }, ctx)

    expect(knowledgeService.addItems).toHaveBeenCalledWith('base-1', items)
  })

  it('delete_items forwards baseId and itemIds', async () => {
    await knowledgeHandlers['knowledge.delete_items']({ baseId: 'base-1', itemIds: ['i1', 'i2'] }, ctx)

    expect(knowledgeService.deleteItems).toHaveBeenCalledWith('base-1', ['i1', 'i2'])
  })

  it('reindex_items forwards baseId and itemIds', async () => {
    await knowledgeHandlers['knowledge.reindex_items']({ baseId: 'base-1', itemIds: ['i1'] }, ctx)

    expect(knowledgeService.reindexItems).toHaveBeenCalledWith('base-1', ['i1'])
  })

  it('search forwards baseId and query and returns the matches', async () => {
    const matches = [{ chunkId: 'c1' }]
    knowledgeService.search.mockResolvedValue(matches)

    const result = await knowledgeHandlers['knowledge.search']({ baseId: 'base-1', query: 'hello' }, ctx)

    expect(knowledgeService.search).toHaveBeenCalledWith('base-1', 'hello')
    expect(result).toBe(matches)
  })

  it('list_item_chunks forwards baseId and itemId and returns the chunks', async () => {
    const chunks = [{ id: 'chunk-1' }]
    knowledgeService.listItemChunks.mockResolvedValue(chunks)

    const result = await knowledgeHandlers['knowledge.list_item_chunks']({ baseId: 'base-1', itemId: 'i1' }, ctx)

    expect(knowledgeService.listItemChunks).toHaveBeenCalledWith('base-1', 'i1')
    expect(result).toBe(chunks)
  })
})
