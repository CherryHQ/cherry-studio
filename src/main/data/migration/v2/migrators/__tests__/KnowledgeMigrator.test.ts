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

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STREAMED_FILE_ID = '019606a0-0000-7000-8000-000000000201'
const LEGACY_FILE_A_ID = '019606a0-0000-7000-8000-000000000301'
const LEGACY_FILE_B_ID = '019606a0-0000-7000-8000-000000000302'
const LEGACY_FILE_SURVIVOR_ID = '019606a0-0000-7000-8000-000000000303'
const LEGACY_FILE_SKIPPED_ID = '019606a0-0000-7000-8000-000000000304'
const LEGACY_FILE_GHOST_ID = '019606a0-0000-7000-8000-000000000305'

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
      id: expect.stringMatching(UUIDV4_PATTERN),
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
    expect(migrator.preparedItems[0].baseId).toBe(migrator.preparedBases[0].id)
    expect(migrator.legacyBaseIdRemap.get('kb-dangling-model')).toBe(migrator.preparedBases[0].id)
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
          chunkSize: 1024,
          chunkOverlap: 200
        }),
        expect.objectContaining({
          chunkSize: 128,
          chunkOverlap: 127
        })
      ])
    )
    expect(migrator.preparedBases.every((base: any) => UUIDV4_PATTERN.test(base.id))).toBe(true)
    expect(migrator.legacyBaseIdRemap.size).toBe(2)
    expect(migrator.legacyBaseIdRemap.get('kb-missing-chunk')).toMatch(UUIDV4_PATTERN)
    expect(migrator.legacyBaseIdRemap.get('kb-small-chunk')).toMatch(UUIDV4_PATTERN)
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
              id: STREAMED_FILE_ID,
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
              id: '019606a0-0000-7000-8000-000000000202',
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
                  { id: 'file-item-1', type: 'file', content: STREAMED_FILE_ID }
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

    const noteItem = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('note-1'))
    const fileItem = migrator.preparedItems.find(
      (item: any) => item.id === migrator.legacyItemIdRemap.get('file-item-1')
    )

    expect(noteItem?.data).toEqual({
      source: 'https://streamed.example.com',
      content: 'streamed note content',
      sourceUrl: 'https://streamed.example.com'
    })
    expect(fileItem?.data).toEqual({
      source: '/tmp/report.pdf',
      fileEntryId: STREAMED_FILE_ID
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
      id: expect.stringMatching(UUIDV4_PATTERN),
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
    const statusByLegacyId = new Map(
      [...migrator.legacyItemIdRemap.entries()].map(([legacyItemId, migratedItemId]) => [
        legacyItemId,
        migrator.preparedItems.find((item: any) => item.id === migratedItemId)?.status
      ])
    )

    expect(result.success).toBe(true)
    expect(statusByLegacyId.get('i-no-unique-id')).toBe('idle')
    expect(statusByLegacyId.get('i-with-unique-id')).toBe('completed')
    expect(statusByLegacyId.get('i-with-empty-unique-id')).toBe('idle')
    expect(statusByLegacyId.get('i-processing-but-no-unique-id')).toBe('failed')
    expect(statusByLegacyId.get('i-failed-with-unique-id')).toBe('failed')
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
      id: expect.stringMatching(UUIDV4_PATTERN),
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
      id: expect.stringMatching(UUIDV4_PATTERN),
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
    expect(migrator.preparedBases.map((base: any) => base.id)).toHaveLength(2)
    expect(migrator.preparedBases.every((base: any) => UUIDV4_PATTERN.test(base.id))).toBe(true)
    expect([...migrator.legacyBaseIdRemap.keys()]).toEqual(['kb-1', 'kb-2'])
    expect([...migrator.legacyItemIdRemap.keys()]).toEqual(['item-1', 'item-dup', 'item-2'])
    expect(migrator.preparedItems.map((item: any) => item.id)).toHaveLength(3)
    expect(migrator.preparedItems.every((item: any) => UUIDV7_PATTERN.test(item.id))).toBe(true)
    expect(migrator.preparedItems.every((item: any) => UUIDV4_PATTERN.test(item.baseId))).toBe(true)
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
    const child = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('child-note'))

    expect(result.success).toBe(true)
    expect(migrator.preparedItems).toHaveLength(2)
    expect(migrator.legacyItemIdRemap.get('parent-url')).toMatch(UUIDV7_PATTERN)
    expect(migrator.legacyItemIdRemap.get('child-note')).toMatch(UUIDV7_PATTERN)
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

  function createDeleteMock() {
    const where = vi.fn().mockResolvedValue(undefined)
    const deleteMock = vi.fn().mockReturnValue({ where })
    return Object.assign(deleteMock, { where })
  }

  function createUpdateMock() {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    const update = vi.fn().mockReturnValue({ set })
    return Object.assign(update, { set, where })
  }

  it('execute returns success immediately when nothing prepared', async () => {
    const migrator = new KnowledgeMigrator()
    const deleteMock = createDeleteMock()

    const result = await migrator.execute({
      db: { delete: deleteMock }
    } as any)

    expect(result).toEqual({
      success: true,
      processedCount: 0
    })
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock.where).toHaveBeenCalledTimes(1)
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
      await callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock() },
      sharedData: new Map()
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
    const update = createUpdateMock()
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert, update })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock() },
      sharedData: new Map()
    } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(4)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it('execute exposes legacy to migrated base and item id remaps for vector migration', async () => {
    const migrator = new KnowledgeMigrator() as any
    const migratedBaseId = '11111111-1111-4111-8111-111111111111'
    const migratedItemId = '0198f3f2-7d1a-7abc-8def-123456789abc'
    migrator.preparedBases = [
      {
        id: migratedBaseId,
        name: 'KB 1',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      }
    ]
    migrator.preparedItems = [
      {
        id: migratedItemId,
        baseId: migratedBaseId,
        groupId: null,
        type: 'note',
        data: { source: 'n1', content: 'n1' },
        status: 'idle',
        error: null
      }
    ]
    migrator.legacyBaseIdRemap = new Map([['legacy-kb-1', migratedBaseId]])
    migrator.legacyItemIdRemap = new Map([['legacy-note-1', migratedItemId]])

    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const update = createUpdateMock()
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert, update })
    })
    const sharedData = new Map<string, unknown>()

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock() },
      sharedData
    } as any)

    expect(result.success).toBe(true)
    expect(sharedData.get('knowledgeBaseIdRemap')).toEqual(new Map([['legacy-kb-1', migratedBaseId]]))
    expect(sharedData.get('knowledgeItemIdRemap')).toEqual(new Map([['legacy-note-1', migratedItemId]]))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.set).toHaveBeenCalledWith({ knowledgeBaseId: migratedBaseId })
    expect(update.where).toHaveBeenCalledTimes(1)
  })

  it('execute drops dangling assistant knowledge base refs after migrating prepared data', async () => {
    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [
      {
        id: 'kb-1',
        name: 'KB 1',
        dimensions: 1024,
        embeddingModelId: 'silicon::BAAI/bge-m3'
      }
    ]
    migrator.preparedItems = []

    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert, update: createUpdateMock() })
    })
    const deleteMock = createDeleteMock()

    const result = await migrator.execute({
      db: { transaction, delete: deleteMock },
      sharedData: new Map()
    } as any)

    expect(result.success).toBe(true)
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock.where).toHaveBeenCalledTimes(1)
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
      await callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock() },
      sharedData: new Map()
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
      await callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock() }
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
   *
   * Per migration-plan §2.9 the v1 file id is preserved verbatim into v2, so
   * file_ref.fileEntryId is just the legacyFileId — no idRemap lookup.
   */
  function makeExecCtx() {
    const sharedData = new Map<string, unknown>()

    // file_ref rows are uniquely identifiable by their `fileEntryId` field —
    // knowledge_base / knowledge_item rows never carry it.
    const insertedInsideTx: unknown[] = []
    const insertedOutsideTx: unknown[] = []
    const isFileRefRow = (r: unknown): r is Record<string, unknown> =>
      !!r && typeof r === 'object' && 'fileEntryId' in r

    const makeInsertFn = (bucket: unknown[]) =>
      vi.fn((/* _table */) => ({
        values: vi.fn(async (rows: unknown) => {
          const arr = Array.isArray(rows) ? rows : [rows]
          bucket.push(...arr)
        })
      }))

    const outerInsert = makeInsertFn(insertedOutsideTx)
    const txInsert = makeInsertFn(insertedInsideTx)
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert: txInsert, update })
    })

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    return {
      sharedData,
      db: { transaction, insert: outerInsert, delete: deleteMock },
      logger,
      insertedInsideTx,
      insertedOutsideTx,
      get fileRefInserts() {
        return [...insertedInsideTx, ...insertedOutsideTx].filter(isFileRefRow)
      },
      get fileRefInsertsInsideTx() {
        return insertedInsideTx.filter(isFileRefRow)
      }
    }
  }

  it('creates one file_ref row for a knowledge item with a fileId (id preserved verbatim)', async () => {
    const legacyFileId = LEGACY_FILE_SURVIVOR_ID
    const ctx = makeExecCtx()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-file-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/foo.pdf', fileEntryId: legacyFileId },
        status: 'idle'
      }
    ]
    vi.spyOn(migrator, 'loadMigratedFileEntryIds').mockResolvedValue(new Set([legacyFileId]))

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(ctx.fileRefInserts).toHaveLength(1)
    expect(ctx.fileRefInserts[0]).toMatchObject({
      fileEntryId: legacyFileId,
      sourceType: 'knowledge_item',
      sourceId: 'item-file-1',
      role: 'source'
    })
    expect(typeof ctx.fileRefInserts[0].id).toBe('string')
  })

  it('skips file_ref creation for a knowledge item without a fileId and records a bucketed warning', async () => {
    const ctx = makeExecCtx()
    loggerWarnMock.mockClear()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-file-missing',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/bar.pdf' },
        status: 'idle'
      }
    ]

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(1)
    expect(ctx.fileRefInserts).toHaveLength(0)
    expect(ctx.insertedInsideTx).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'item-file-missing' })])
    )
    const summaryCall = loggerWarnMock.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('knowledge_item_missing_file_id')
    )
    expect(summaryCall).toBeDefined()
    expect(summaryCall![0]).toContain('count=1')
    expect(summaryCall![0]).toContain('item-file-missing')
  })

  it('creates one file_ref per file item; skips non-file types', async () => {
    const ctx = makeExecCtx()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-a',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/a.pdf', fileEntryId: LEGACY_FILE_A_ID },
        status: 'idle'
      },
      {
        id: 'item-b',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/b.pdf', fileEntryId: LEGACY_FILE_B_ID },
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
    vi.spyOn(migrator, 'loadMigratedFileEntryIds').mockResolvedValue(new Set([LEGACY_FILE_A_ID, LEGACY_FILE_B_ID]))

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(ctx.fileRefInserts).toHaveLength(2)
    const refSourceIds = ctx.fileRefInserts.map((r) => r.sourceId).sort()
    expect(refSourceIds).toEqual(['item-a', 'item-b'])
    const refFileEntryIds = ctx.fileRefInserts.map((r) => r.fileEntryId).sort()
    expect(refFileEntryIds).toEqual([LEGACY_FILE_A_ID, LEGACY_FILE_B_ID])
  })

  it('inserts file_ref rows inside the per-base transaction (atomic with base + items)', async () => {
    const ctx = makeExecCtx()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-a',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/a.pdf', fileEntryId: LEGACY_FILE_A_ID },
        status: 'idle'
      }
    ]
    vi.spyOn(migrator, 'loadMigratedFileEntryIds').mockResolvedValue(new Set([LEGACY_FILE_A_ID]))

    await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    // file_ref must appear in the per-base transaction, not via outer db.insert,
    // so base + items + refs commit atomically (if file_ref fails, base is rolled
    // back and the next run retries everything cleanly).
    expect(ctx.fileRefInsertsInsideTx).toHaveLength(1)
    expect(ctx.insertedOutsideTx).toHaveLength(0)
  })

  it('skips file_ref creation when legacyFileId is absent from v2 file_entry (dangling guard)', async () => {
    const ctx = makeExecCtx()
    loggerWarnMock.mockClear()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-survivor',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/ok.pdf', fileEntryId: LEGACY_FILE_SURVIVOR_ID },
        status: 'idle'
      },
      {
        id: 'item-skipped-by-filemigrator',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/bad.xyz', fileEntryId: LEGACY_FILE_SKIPPED_ID },
        status: 'idle'
      },
      {
        id: 'item-orphan-ref',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/ghost.pdf', fileEntryId: LEGACY_FILE_GHOST_ID },
        status: 'idle'
      }
    ]
    // Only the survivor exists in v2 file_entry; the other two are dangling
    // (one was dropped by FileMigrator; the other never existed).
    migrator.legacyItemIdRemap = new Map([
      ['legacy-item-survivor', 'item-survivor'],
      ['legacy-item-skipped', 'item-skipped-by-filemigrator'],
      ['legacy-item-ghost', 'item-orphan-ref']
    ])
    vi.spyOn(migrator, 'loadMigratedFileEntryIds').mockResolvedValue(new Set([LEGACY_FILE_SURVIVOR_ID]))

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(2)
    expect(ctx.fileRefInserts).toHaveLength(1)
    expect(ctx.insertedInsideTx).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'item-skipped-by-filemigrator' }),
        expect.objectContaining({ id: 'item-orphan-ref' })
      ])
    )
    expect(ctx.sharedData.get('knowledgeItemIdRemap')).toEqual(new Map([['legacy-item-survivor', 'item-survivor']]))
    expect(ctx.fileRefInserts[0]).toMatchObject({
      fileEntryId: LEGACY_FILE_SURVIVOR_ID,
      sourceId: 'item-survivor'
    })
    const summaryCall = loggerWarnMock.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('knowledge_item_dangling_file_entry')
    )
    expect(summaryCall).toBeDefined()
    expect(summaryCall![0]).toContain('count=2')
    // Sample messages should mention both dangling item ids (limit=3 so both fit).
    expect(summaryCall![0]).toContain('item-skipped-by-filemigrator')
    expect(summaryCall![0]).toContain('item-orphan-ref')
  })
})
