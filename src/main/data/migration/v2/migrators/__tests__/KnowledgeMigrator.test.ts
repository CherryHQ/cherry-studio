import fs from 'node:fs'

import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeMigrator } from '../KnowledgeMigrator'

vi.mock('@libsql/client', () => ({
  createClient: vi.fn()
}))

describe('KnowledgeMigrator dimensions resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves dimensions from vector blob even when legacy dimensions exists', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-legacy')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 10, with_vector: 10 }] })
      .mockResolvedValueOnce({ rows: [{ bytes: 4096 }] })
    const close = vi.fn()
    const createClientMock = createClient as unknown as { mockReturnValue: (value: unknown) => void }
    createClientMock.mockReturnValue({ execute, close })

    const result = await migrator.resolveDimensionsForBase({
      id: 'kb-legacy',
      name: 'Legacy KB',
      dimensions: 768
    })

    expect(result).toEqual({ dimensions: 1024, reason: 'ok' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns vector_db_missing when legacy vector DB file does not exist', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-missing')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(false)

    const result = await migrator.resolveDimensionsForBase({
      id: 'kb-missing',
      name: 'Missing KB'
    })

    expect(result).toEqual({ dimensions: null, reason: 'vector_db_missing' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns vector_db_empty when vectors table has no rows', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-empty')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ total: 0, with_vector: null }] })
    const close = vi.fn()
    const createClientMock = createClient as unknown as { mockReturnValue: (value: unknown) => void }
    createClientMock.mockReturnValue({ execute, close })

    const result = await migrator.resolveDimensionsForBase({
      id: 'kb-empty',
      name: 'Empty KB'
    })

    expect(result).toEqual({ dimensions: null, reason: 'vector_db_empty' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns invalid_vector_dimensions when vector byte length is invalid', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-invalid')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1, with_vector: 1 }] })
      .mockResolvedValueOnce({ rows: [{ bytes: 3 }] })
    const close = vi.fn()
    const createClientMock = createClient as unknown as { mockReturnValue: (value: unknown) => void }
    createClientMock.mockReturnValue({ execute, close })

    const result = await migrator.resolveDimensionsForBase({
      id: 'kb-invalid',
      name: 'Invalid KB'
    })

    expect(result).toEqual({ dimensions: null, reason: 'invalid_vector_dimensions' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prepare skips base and items when vector DB is empty', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: null,
      reason: 'vector_db_empty'
    })

    const ctx = {
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-empty',
                name: 'Empty KB',
                model: { id: 'm1', name: 'model-1', provider: 'openai' },
                items: [
                  { id: 'i1', type: 'url', content: 'https://example.com' },
                  { id: 'i2', type: 'note', content: 'test' }
                ]
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(0)
    expect(migrator.preparedItems).toHaveLength(0)
    expect(migrator.skippedCount).toBe(3)
    expect(migrator.sourceCount).toBe(3)
    expect(result.warnings?.some((warning: string) => warning.includes('Skipped knowledge base kb-empty'))).toBe(true)
  })

  it('prepare converts embedding/rerank model ids to provider::modelId format', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-model-format',
                name: 'KB model format',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                rerankModel: { id: 'Qwen/Qwen3-Reranker-8B', name: 'Qwen/Qwen3-Reranker-8B', provider: 'silicon' },
                items: []
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0].embeddingModelId).toBe('silicon::BAAI/bge-m3')
    expect(migrator.preparedBases[0].rerankModelId).toBe('silicon::Qwen/Qwen3-Reranker-8B')
    expect(migrator.skippedCount).toBe(0)
  })

  it('prepare skips base and items when embedding model is missing', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-no-model',
                name: 'KB without model',
                items: [
                  { id: 'i1', type: 'url', content: 'https://example.com' },
                  { id: 'i2', type: 'note', content: 'test' }
                ]
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(0)
    expect(migrator.preparedItems).toHaveLength(0)
    expect(migrator.skippedCount).toBe(3)
    expect(migrator.sourceCount).toBe(3)
    expect(result.warnings?.some((warning: string) => warning.includes('embedding_model_missing'))).toBe(true)
  })

  it('prepare ignores legacy parentId and migrates items as root nodes', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-tree',
                name: 'KB tree',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  { id: 'parent-url', type: 'url', content: 'https://example.com' },
                  { id: 'child-note', type: 'note', parentId: 'parent-url', content: 'child note' }
                ]
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      }
    } as any

    const result = await migrator.prepare(ctx)
    const child = migrator.preparedItems.find((item: any) => item.id === 'child-note')

    expect(result.success).toBe(true)
    expect(migrator.preparedItems).toHaveLength(2)
    expect(child?.parentId).toBeNull()
  })
})

describe('KnowledgeMigrator execute/validate paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('execute returns success immediately when nothing prepared', async () => {
    const migrator = new KnowledgeMigrator()

    const result = await migrator.execute({} as any)

    expect(result).toEqual({
      success: true,
      processedCount: 0
    })
  })

  it('execute returns failed result when insert throws', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: 'kb-exec-fail',
        name: 'KB exec fail',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      }
    ]
    migrator.preparedItems = []

    const values = vi.fn().mockRejectedValue(new Error('insert failed'))
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert })
    })

    const result = await migrator.execute({
      db: { transaction }
    } as any)

    expect(result.success).toBe(false)
    expect(result.processedCount).toBe(0)
    expect(result.error).toContain('insert failed')
  })

  it('validate reports orphan knowledge items', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.sourceCount = 5
    migrator.skippedCount = 1

    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 2 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 3 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: 1 })
          })
        })
      })

    const result = await migrator.validate({
      db: { select }
    } as any)

    expect(result.success).toBe(false)
    expect(result.errors.some((error) => error.key === 'knowledge_orphan_items')).toBe(true)
    expect(result.stats.targetCount).toBe(5)
    expect(result.stats.sourceCount).toBe(5)
    expect(result.stats.skippedCount).toBe(1)
  })
})
