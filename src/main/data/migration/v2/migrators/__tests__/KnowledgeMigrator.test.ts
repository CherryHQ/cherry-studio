import fs from 'node:fs'

import { createClient } from '@libsql/client'
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

  it('prepare preserves knowledge base and clears dangling model references', async () => {
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
                id: 'kb-dangling-model',
                name: 'Dangling KB',
                model: { id: 'qwen', name: 'qwen', provider: 'cherryai' },
                rerankModel: { id: 'rerank', name: 'rerank', provider: 'cherryai' },
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
          from: vi.fn().mockResolvedValue([{ id: 'openai::text-embedding-3-small' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)

    expect(result.success).toBe(true)
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0].embeddingModelId).toBeNull()
    expect(migrator.preparedBases[0].rerankModelId).toBeNull()
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

  it('prepare preserves base and items when embedding model is missing', async () => {
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
    expect(migrator.preparedItems).toHaveLength(2)
    expect(migrator.skippedCount).toBe(0)
    expect(migrator.sourceCount).toBe(3)
    expect(migrator.preparedBases[0].embeddingModelId).toBeNull()
    expect(
      result.warnings?.some((warning: string) => warning.includes('missing embedding model reference was cleared'))
    ).toBe(true)
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
    expect(result.warnings).toContain('Skipped duplicate knowledge base kb-1')
    expect(result.warnings).toContain('Skipped duplicate knowledge item item-dup in base kb-2')
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
