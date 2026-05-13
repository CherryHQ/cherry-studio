import fs from 'node:fs'

import { createClient } from '@libsql/client'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { KnowledgeMigrator } from '../KnowledgeMigrator'

vi.mock('@libsql/client', () => ({
  createClient: vi.fn()
}))

describe('KnowledgeMigrator dimensions resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const existsSyncMock = fs.existsSync as unknown as {
      mockReset?: () => void
      mockReturnValue?: (value: boolean) => void
    }
    existsSyncMock.mockReset?.()

    const statSyncMock = fs.statSync as unknown as {
      mockReset?: () => void
      mockReturnValue?: (value: unknown) => void
    }
    statSyncMock.mockReset?.()
    statSyncMock.mockReturnValue?.({
      isDirectory: () => false
    })
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

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-legacy',
        name: 'Legacy KB',
        dimensions: 768
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: 1024, reason: 'ok' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns vector_db_missing when legacy vector DB file does not exist', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-missing')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(false)

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-missing',
        name: 'Missing KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

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

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-empty',
        name: 'Empty KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

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

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-invalid',
        name: 'Invalid KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'invalid_vector_dimensions' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns vector_db_invalid_path when resolved legacy vector DB path is invalid', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue(null)

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-invalid-path',
        name: 'Invalid path KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'vector_db_invalid_path' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns legacy_vector_store_directory when resolved path is a directory', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-dir')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const statSyncMock = fs.statSync as unknown as { mockReturnValue: (value: unknown) => void }
    statSyncMock.mockReturnValue({
      isDirectory: () => true
    })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-dir',
        name: 'Directory KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'legacy_vector_store_directory' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('records a warning when closing the legacy vector DB client fails', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-close-error')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 10, with_vector: 10 }] })
      .mockResolvedValueOnce({ rows: [{ bytes: 4096 }] })
    const close = vi.fn().mockImplementation(() => {
      throw new Error('close failed')
    })
    const createClientMock = createClient as unknown as { mockReturnValue: (value: unknown) => void }
    createClientMock.mockReturnValue({ execute, close })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-close-error',
        name: 'Close Error KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: 1024, reason: 'ok' })
    expect(migrator.warnings).toContain(
      'Failed to close legacy vector DB client for knowledge base kb-close-error: close failed'
    )
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to close legacy vector DB client for knowledge base kb-close-error: close failed'
    )
  })

  it('returns vector_db_error when createClient throws synchronously', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-create-error')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const statSyncMock = fs.statSync as unknown as { mockReturnValue: (value: unknown) => void }
    statSyncMock.mockReturnValue({
      isDirectory: () => false
    })

    const createClientMock = createClient as unknown as { mockImplementation: (value: () => never) => void }
    createClientMock.mockImplementation(() => {
      throw new Error('open failed')
    })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-create-error',
        name: 'Create Error KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'vector_db_error' })
    expect(migrator.warnings).toContain(
      'Failed to inspect legacy vector DB for knowledge base kb-create-error: open failed'
    )
  })

  it('prepare skips base and items when vector DB is empty', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: null,
      reason: 'vector_db_empty'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
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

  it('prepare preserves knowledge base and items with dangling embedding model reference', async () => {
    const migrator = new KnowledgeMigrator() as any
    const resolveDimensionsForBase = vi
      .spyOn(migrator, 'resolveDimensionsForBase')
      .mockRejectedValue(new Error('should not inspect vector DB for missing models'))

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dangling-model',
                name: 'Dangling KB',
                dimensions: 768,
                model: { id: 'qwen', name: 'qwen', provider: 'cherryai' },
                rerankModel: { id: 'rerank', name: 'rerank', provider: 'cherryai' },
                items: [{ id: 'item-1', type: 'note', content: 'test' }]
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'openai::text-embedding-3-small' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0]).toMatchObject({
      id: 'kb-dangling-model',
      dimensions: 768,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
      rerankModelId: null
    })
    expect(migrator.preparedItems).toHaveLength(1)
    expect(migrator.skippedCount).toBe(0)
    expect(migrator.sourceCount).toBe(2)
    expect(resolveDimensionsForBase).not.toHaveBeenCalled()
    expect(result.warnings?.some((warning: string) => warning.includes('dangling embedding model reference'))).toBe(
      true
    )
  })

  it('prepare materializes valid chunk defaults for migrated knowledge bases', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-missing-chunk',
                name: 'Missing chunk config',
                model: { id: 'm1', name: 'model-1', provider: 'openai' },
                items: []
              },
              {
                id: 'kb-small-chunk',
                name: 'Small chunk config',
                model: { id: 'm2', name: 'model-2', provider: 'openai' },
                chunkSize: 128,
                items: []
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'openai::m1' }, { id: 'openai::m2' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(2)
    expect(migrator.preparedBases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kb-missing-chunk',
          chunkSize: 1024,
          chunkOverlap: 200
        }),
        expect.objectContaining({
          id: 'kb-small-chunk',
          chunkSize: 128,
          chunkOverlap: 127
        })
      ])
    )
  })

  it('prepare skips base and items when legacy knowledge store path is a directory', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: null,
      reason: 'legacy_vector_store_directory'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'Directory KB',
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
    expect(
      result.warnings?.some((warning: string) =>
        warning.includes('Skipped knowledge base kb-dir: legacy_vector_store_directory')
      )
    ).toBe(true)
  })

  it('prepare returns a warning when the knowledge Redux category is unavailable', async () => {
    const migrator = new KnowledgeMigrator() as any

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue(undefined)
        },
        dexieExport: {
          tableExists: vi.fn(),
          readTable: vi.fn()
        }
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result).toEqual({
      success: true,
      itemCount: 0,
      warnings: ['knowledge Redux category not found - no knowledge data to migrate']
    })
    expect(migrator.sourceCount).toBe(0)
    expect(migrator.preparedBases).toHaveLength(0)
    expect(migrator.preparedItems).toHaveLength(0)
  })

  it('prepare streams knowledge note and file lookups instead of loading whole Dexie tables', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const noteReader = {
      readInBatches: vi.fn().mockImplementation(async (_batchSize, onBatch) => {
        await onBatch(
          [
            {
              id: 'note-1',
              content: 'streamed note content',
              sourceUrl: 'https://streamed.example.com'
            },
            {
              id: 'note-unused',
              content: 'unused'
            }
          ],
          0
        )
      })
    }
    const fileReader = {
      readInBatches: vi.fn().mockImplementation(async (_batchSize, onBatch) => {
        await onBatch(
          [
            {
              id: 'file-1',
              name: 'report.pdf',
              origin_name: 'report.pdf',
              path: '/tmp/report.pdf',
              size: 123,
              ext: '.pdf',
              type: 'document',
              created_at: '2026-03-24T00:00:00.000Z',
              count: 1
            },
            {
              id: 'file-unused',
              name: 'unused.pdf',
              origin_name: 'unused.pdf',
              path: '/tmp/unused.pdf',
              size: 50,
              ext: '.pdf',
              type: 'document',
              created_at: '2026-03-24T00:00:00.000Z',
              count: 1
            }
          ],
          0
        )
      })
    }
    const readTable = vi.fn().mockRejectedValue(new Error('prepare should not use readTable for streamed tables'))
    const createStreamReader = vi.fn((tableName: string) => {
      if (tableName === 'knowledge_notes') {
        return noteReader
      }
      if (tableName === 'files') {
        return fileReader
      }
      throw new Error(`Unexpected table: ${tableName}`)
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-stream',
                name: 'KB stream',
                model: { id: 'm1', name: 'model-1', provider: 'openai' },
                items: [
                  { id: 'note-1', type: 'note', content: 'redux fallback' },
                  { id: 'file-item-1', type: 'file', content: 'file-1' }
                ]
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(true),
          readTable,
          createStreamReader
        }
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(readTable).not.toHaveBeenCalled()
    expect(createStreamReader).toHaveBeenCalledWith('knowledge_notes')
    expect(createStreamReader).toHaveBeenCalledWith('files')

    const noteItem = migrator.preparedItems.find((item: any) => item.id === 'note-1')
    const fileItem = migrator.preparedItems.find((item: any) => item.id === 'file-item-1')

    expect(noteItem?.data).toEqual({
      source: 'https://streamed.example.com',
      content: 'streamed note content',
      sourceUrl: 'https://streamed.example.com'
    })
    expect(fileItem?.data).toEqual({
      source: '/tmp/report.pdf',
      file: expect.objectContaining({
        id: 'file-1',
        name: 'report.pdf'
      })
    })
    expect(noteReader.readInBatches).toHaveBeenCalledTimes(1)
    expect(fileReader.readInBatches).toHaveBeenCalledTimes(1)
  })

  it('prepare converts embedding/rerank model ids to provider::modelId format', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
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
    expect(migrator.preparedBases[0].searchMode).toBe('hybrid')
    expect(migrator.skippedCount).toBe(0)
  })

  it('prepare clears dangling rerank model reference while keeping resolved embedding model', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dangling-rerank',
                name: 'KB dangling rerank',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                rerankModel: { id: 'missing-rerank', name: 'missing-rerank', provider: 'silicon' },
                items: []
              }
            ]
          })
        },
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(false),
          readTable: vi.fn()
        }
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0]).toMatchObject({
      id: 'kb-dangling-rerank',
      embeddingModelId: 'silicon::BAAI/bge-m3',
      status: 'completed',
      error: null,
      rerankModelId: null
    })
    expect(result.warnings).toContain(
      'Knowledge base kb-dangling-rerank: dangling rerank model reference silicon::missing-rerank was cleared'
    )
  })

  it('prepare infers item status from legacy uniqueId', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-status',
                name: 'KB status',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  { id: 'i-no-unique-id', type: 'note', content: 'n1' },
                  { id: 'i-with-unique-id', type: 'note', content: 'n2', uniqueId: 'local_loader_1' },
                  { id: 'i-with-empty-unique-id', type: 'note', content: 'n3', uniqueId: '   ' },
                  { id: 'i-processing-but-no-unique-id', type: 'note', content: 'n4', processingStatus: 'processing' },
                  {
                    id: 'i-failed-with-unique-id',
                    type: 'note',
                    content: 'n5',
                    processingStatus: 'failed',
                    uniqueId: 'x'
                  }
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
    const statusById = new Map(migrator.preparedItems.map((item: any) => [item.id, item.status]))

    expect(result.success).toBe(true)
    expect(statusById.get('i-no-unique-id')).toBe('idle')
    expect(statusById.get('i-with-unique-id')).toBe('completed')
    expect(statusById.get('i-with-empty-unique-id')).toBe('idle')
    expect(statusById.get('i-processing-but-no-unique-id')).toBe('idle')
    expect(statusById.get('i-failed-with-unique-id')).toBe('completed')
  })

  it('prepare preserves failed missing-model bases with null dimensions when legacy dimensions are missing', async () => {
    const migrator = new KnowledgeMigrator() as any
    const resolveDimensionsForBase = vi
      .spyOn(migrator, 'resolveDimensionsForBase')
      .mockRejectedValue(new Error('should not inspect vector DB for missing models'))

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
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
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0]).toMatchObject({
      id: 'kb-no-model',
      dimensions: null,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
    })
    expect(migrator.preparedItems).toHaveLength(2)
    expect(migrator.skippedCount).toBe(0)
    expect(migrator.sourceCount).toBe(3)
    expect(resolveDimensionsForBase).not.toHaveBeenCalled()
  })

  it('prepare preserves legacy dimensions for failed bases when embedding model is missing', async () => {
    const migrator = new KnowledgeMigrator() as any
    const resolveDimensionsForBase = vi
      .spyOn(migrator, 'resolveDimensionsForBase')
      .mockRejectedValue(new Error('should not inspect vector DB for missing models'))

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-no-model',
                name: 'KB without model',
                dimensions: 768,
                items: [{ id: 'i1', type: 'note', content: 'test' }]
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
    expect(migrator.preparedBases[0]).toMatchObject({
      id: 'kb-no-model',
      dimensions: 768,
      embeddingModelId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
    })
    expect(resolveDimensionsForBase).not.toHaveBeenCalled()
  })

  it('prepare skips duplicate base ids and duplicate item ids with warnings', async () => {
    const migrator = new KnowledgeMigrator() as any
    const resolveDimensionsForBase = vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-1',
                name: 'KB 1',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  { id: 'item-1', type: 'note', content: 'first item' },
                  { id: 'item-dup', type: 'note', content: 'first duplicate item' }
                ]
              },
              {
                id: 'kb-1',
                name: 'KB 1 duplicate',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [{ id: 'item-in-duplicate-base', type: 'note', content: 'skip whole base' }]
              },
              {
                id: 'kb-2',
                name: 'KB 2',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  { id: 'item-dup', type: 'note', content: 'second duplicate item' },
                  { id: 'item-2', type: 'note', content: 'second item' }
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
    expect(resolveDimensionsForBase).toHaveBeenCalledTimes(2)
    expect(migrator.sourceCount).toBe(8)
    expect(migrator.skippedCount).toBe(3)
    expect(migrator.preparedBases.map((base: any) => base.id)).toEqual(['kb-1', 'kb-2'])
    expect(migrator.preparedItems.map((item: any) => item.id)).toEqual(['item-1', 'item-dup', 'item-2'])
    expect(
      result.warnings?.some(
        (warning: string) =>
          warning.includes('Skipped knowledge records (duplicate_knowledge_base): count=1') &&
          warning.includes('Skipped duplicate knowledge base kb-1')
      )
    ).toBe(true)
    expect(
      result.warnings?.some(
        (warning: string) =>
          warning.includes('Skipped knowledge records (duplicate_knowledge_item): count=1') &&
          warning.includes('Skipped duplicate knowledge item item-dup in base kb-2')
      )
    ).toBe(true)
  })

  it('prepare migrates legacy flat items without grouping metadata', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
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
                  { id: 'child-note', type: 'note', content: 'child note' }
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
    expect(child?.groupId).toBeNull()
  })

  it('prepare records a warning when invalid knowledge base config is normalized', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({
      dimensions: 1024,
      reason: 'ok'
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-invalid-config',
                name: 'KB invalid config',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                chunkSize: 200,
                chunkOverlap: 200,
                threshold: 2,
                documentCount: 0,
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
    expect(
      result.warnings?.some(
        (warning) =>
          warning.includes('Knowledge base kb-invalid-config: cleared invalid config fields:') &&
          warning.includes('chunkOverlap') &&
          warning.includes('threshold') &&
          warning.includes('documentCount')
      )
    ).toBe(true)
    expect(
      loggerWarnMock.mock.calls.some(
        ([warning]) =>
          typeof warning === 'string' &&
          warning.includes('Knowledge base kb-invalid-config: cleared invalid config fields:') &&
          warning.includes('chunkOverlap') &&
          warning.includes('threshold') &&
          warning.includes('documentCount')
      )
    ).toBe(true)
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

  it('execute uses one transaction per prepared knowledge base', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: 'kb-1',
        name: 'KB 1',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      },
      {
        id: 'kb-2',
        name: 'KB 2',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      }
    ]
    migrator.preparedItems = [
      {
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { content: 'n1' },
        status: 'idle'
      },
      {
        id: 'item-2',
        baseId: 'kb-2',
        groupId: null,
        type: 'note',
        data: { content: 'n2' },
        status: 'idle'
      }
    ]

    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert })
    })

    const result = await migrator.execute({
      db: { transaction }
    } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(4)
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('execute writes recoverable failed bases and their items', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: 'kb-missing-model',
        name: 'Missing Model KB',
        groupId: null,
        emoji: '📁',
        dimensions: 768,
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
        rerankModelId: null,
        fileProcessorId: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        threshold: null,
        documentCount: null,
        searchMode: 'hybrid',
        hybridAlpha: null,
        createdAt: 1775114958369,
        updatedAt: 1775114958369
      }
    ]
    migrator.preparedItems = [
      {
        id: 'item-1',
        baseId: 'kb-missing-model',
        groupId: null,
        type: 'note',
        data: { source: 'note', content: 'note' },
        status: 'idle',
        phase: null,
        error: null,
        createdAt: 1775114958369,
        updatedAt: 1775114958369
      }
    ]

    const insertedValues: unknown[] = []
    const values = vi.fn(async (value: unknown) => {
      insertedValues.push(value)
    })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert })
    })

    const result = await migrator.execute({
      db: { transaction }
    } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(2)
    expect(insertedValues).toEqual([
      expect.objectContaining({
        id: 'kb-missing-model',
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      }),
      [
        expect.objectContaining({
          id: 'item-1',
          baseId: 'kb-missing-model',
          status: 'idle'
        })
      ]
    ])
  })

  it('execute failure keeps processedCount to already committed base groups only', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: 'kb-1',
        name: 'KB 1',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      },
      {
        id: 'kb-2',
        name: 'KB 2',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      }
    ]
    migrator.preparedItems = [
      {
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { content: 'n1' },
        status: 'idle'
      },
      {
        id: 'item-2',
        baseId: 'kb-2',
        groupId: null,
        type: 'note',
        data: { content: 'n2' },
        status: 'idle'
      }
    ]

    const values = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second base failed'))
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert })
    })

    const result = await migrator.execute({
      db: { transaction }
    } as any)

    expect(result.success).toBe(false)
    expect(result.processedCount).toBe(2)
    expect(result.error).toContain('second base failed')
    expect(transaction).toHaveBeenCalledTimes(2)
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

  it('validate reports per-entity count mismatches even when total count matches expected', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.sourceCount = 8
    migrator.skippedCount = 1
    migrator.preparedBases = [{ id: 'kb-1' }, { id: 'kb-2' }]
    migrator.preparedItems = [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }, { id: 'item-4' }, { id: 'item-5' }]

    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 1 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 6 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: 0 })
          })
        })
      })

    const result = await migrator.validate({
      db: { select }
    } as any)

    expect(result.success).toBe(false)
    expect(result.stats.targetCount).toBe(7)
    expect(result.stats.sourceCount).toBe(8)
    expect(result.stats.skippedCount).toBe(1)
    expect(result.errors.some((error) => error.key === 'knowledge_base_count_mismatch')).toBe(true)
  })
})

describe('KnowledgeMigrator file_ref creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Build a minimal ctx mock that captures insert calls made outside the
   * knowledge-base transaction (i.e. the file_ref inserts).
   */
  function makeExecCtx(idRemap?: Map<string, string>) {
    const sharedData = new Map<string, unknown>()
    if (idRemap !== undefined) {
      sharedData.set('file.idRemap', idRemap)
    }

    const insertedOutsideTx: unknown[] = []
    const outerInsert = vi.fn((/* _table */) => ({
      values: vi.fn((rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [rows]
        insertedOutsideTx.push(...arr)
        return { onConflictDoNothing: vi.fn(() => Promise.resolve()) }
      })
    }))

    const txInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert: txInsert })
    })

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    return {
      sharedData,
      db: { transaction, insert: outerInsert },
      logger,
      insertedOutsideTx,
      outerInsert
    }
  }

  it('creates one file_ref row for a knowledge item with a valid v1 fileId', async () => {
    const legacyFileId = 'legacy-file-001'
    const v2FileId = 'v2-file-uuid-001'
    const idRemap = new Map([[legacyFileId, v2FileId]])
    const { sharedData, db, logger, insertedOutsideTx } = makeExecCtx(idRemap)

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-file-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/foo.pdf', file: { id: legacyFileId, name: 'foo.pdf' } },
        status: 'idle'
      }
    ]

    const result = await migrator.execute({ db, sharedData, logger } as any)

    expect(result.success).toBe(true)
    expect(insertedOutsideTx).toHaveLength(1)
    expect(insertedOutsideTx[0]).toMatchObject({
      fileEntryId: v2FileId,
      sourceType: 'knowledge_item',
      sourceId: 'item-file-1',
      role: 'attachment'
    })
    expect(typeof (insertedOutsideTx[0] as any).id).toBe('string')
  })

  it('skips file_ref creation for a knowledge item whose fileId is not in idRemap', async () => {
    const idRemap = new Map([['other-id', 'v2-other']])
    const { sharedData, db, logger, insertedOutsideTx } = makeExecCtx(idRemap)

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-file-missing',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/bar.pdf', file: { id: 'missing-legacy-id', name: 'bar.pdf' } },
        status: 'idle'
      }
    ]

    const result = await migrator.execute({ db, sharedData, logger } as any)

    expect(result.success).toBe(true)
    expect(insertedOutsideTx).toHaveLength(0)
  })

  it('creates correct number of file_ref rows for multiple items referencing different v2 ids', async () => {
    const idRemap = new Map([
      ['legacy-a', 'v2-a'],
      ['legacy-b', 'v2-b']
    ])
    const { sharedData, db, logger, insertedOutsideTx } = makeExecCtx(idRemap)

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-a',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/a.pdf', file: { id: 'legacy-a', name: 'a.pdf' } },
        status: 'idle'
      },
      {
        id: 'item-b',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/b.pdf', file: { id: 'legacy-b', name: 'b.pdf' } },
        status: 'idle'
      },
      {
        id: 'item-note',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'some note', content: 'some note' },
        status: 'idle'
      }
    ]

    const result = await migrator.execute({ db, sharedData, logger } as any)

    expect(result.success).toBe(true)
    expect(insertedOutsideTx).toHaveLength(2)
    const refSourceIds = insertedOutsideTx.map((r) => (r as any).sourceId).sort()
    expect(refSourceIds).toEqual(['item-a', 'item-b'])
    const refFileEntryIds = insertedOutsideTx.map((r) => (r as any).fileEntryId).sort()
    expect(refFileEntryIds).toEqual(['v2-a', 'v2-b'])
  })

  it('file_ref insert is retry-safe: second execute() with same data does not throw UNIQUE constraint error', async () => {
    // Simulate the retry scenario:
    // - First execute() succeeds and inserts file_ref rows.
    // - Second execute() (retry after KnowledgeMigrator failure) attempts to insert
    //   the same rows again. Without onConflictDoNothing(), this would throw a
    //   UNIQUE constraint error on (fileEntryId, sourceType, sourceId, role).
    //   With onConflictDoNothing(), it must succeed silently.
    const legacyFileId = 'legacy-retry-file'
    const v2FileId = 'v2-retry-uuid'
    const idRemap = new Map([[legacyFileId, v2FileId]])

    const sharedData = new Map<string, unknown>()
    sharedData.set('file.idRemap', idRemap)

    // The mock simulates the real DB behaviour:
    // - values() returns an object with onConflictDoNothing().
    // - onConflictDoNothing() always resolves (the DB absorbs any conflict silently).
    // Without the fix, the code awaits values() directly and the UNIQUE constraint
    // would propagate as an error on retry. With the fix, the code chains
    // onConflictDoNothing() which resolves successfully even on a second attempt.
    const onConflictDoNothingMock = vi.fn(() => Promise.resolve())
    const outerInsert = vi.fn((_table: unknown) => ({
      values: vi.fn((_rows: unknown) => ({
        onConflictDoNothing: onConflictDoNothingMock
      }))
    }))

    const txInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert: txInsert })
    })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const db = { transaction, insert: outerInsert }

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-retry', name: 'KB retry', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-retry-file',
        baseId: 'kb-retry',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/retry.pdf', file: { id: legacyFileId, name: 'retry.pdf' } },
        status: 'idle'
      }
    ]

    // First execute: should succeed and call onConflictDoNothing once.
    const firstResult = await migrator.execute({ db, sharedData, logger } as any)
    expect(firstResult.success).toBe(true)
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1)

    // Second execute: simulates retry. With the fix, onConflictDoNothing() absorbs
    // any duplicate-row conflict and the insert resolves successfully.
    const secondResult = await migrator.execute({ db, sharedData, logger } as any)
    expect(secondResult.success).toBe(true)
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(2)
  })
})
