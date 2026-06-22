import fs from 'node:fs'

import { createClient } from '@libsql/client'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
} from '@shared/data/types/knowledge'
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

import { KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY, KnowledgeMigrator } from '../KnowledgeMigrator'
import { transformKnowledgeItem } from '../mappings/KnowledgeMappings'

vi.mock('@libsql/client', () => ({
  createClient: vi.fn()
}))

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STREAMED_FILE_ID = '019606a0-0000-7000-8000-000000000201'

describe('KnowledgeMappings', () => {
  it('migrates legacy sitemap items as url items', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'legacy-sitemap-1',
        type: 'sitemap',
        content: 'https://example.com/sitemap.xml',
        uniqueId: 'loader-sitemap'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        baseId: 'kb-1',
        groupId: null,
        type: 'url',
        data: {
          source: 'https://example.com/sitemap.xml',
          url: 'https://example.com/sitemap.xml'
        },
        status: 'completed',
        error: null
      }
    })
  })

  it('trims whitespace around legacy sitemap content before migrating', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'legacy-sitemap-2',
        type: 'sitemap',
        content: '   https://example.com/sitemap.xml   ',
        uniqueId: 'loader-sitemap'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        baseId: 'kb-1',
        groupId: null,
        type: 'url',
        data: {
          source: 'https://example.com/sitemap.xml',
          url: 'https://example.com/sitemap.xml'
        },
        status: 'completed',
        error: null
      }
    })
  })

  it('keeps invalid legacy sitemap items skippable', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'legacy-sitemap-1',
        type: 'sitemap',
        content: '   '
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_sitemap'
    })
  })
})

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
    // The embedding model resolved but the vector store is empty, so dimensions are unknown.
    // Keep the base (and its items) as a restorable `failed` row instead of dropping it — a
    // dropped base is an unrecoverable loss with no restore entry in the UI.
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0]).toMatchObject({
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE,
      dimensions: null,
      embeddingModelId: 'openai::m1'
    })
    expect(migrator.preparedItems).toHaveLength(2)
    expect(migrator.skippedCount).toBe(0)
    expect(migrator.sourceCount).toBe(3)
    expect(
      result.warnings?.some((warning: string) => warning.includes('kb-empty') && warning.includes('failed base'))
    ).toBe(true)
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

  it('prepare keeps the base as a restorable failed row when the legacy store path is a directory', async () => {
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
    expect(migrator.preparedBases).toHaveLength(1)
    expect(migrator.preparedBases[0]).toMatchObject({
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE,
      dimensions: null,
      embeddingModelId: 'openai::m1'
    })
    expect(migrator.preparedItems).toHaveLength(2)
    expect(migrator.skippedCount).toBe(0)
    expect(migrator.sourceCount).toBe(3)
    expect(
      result.warnings?.some(
        (warning: string) => warning.includes('kb-dir') && warning.includes('legacy_vector_store_directory')
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
      content: 'streamed note content'
    })
    expect(fileItem?.data).toEqual({
      source: '/tmp/report.pdf',
      relativePath: 'report.pdf'
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

  it('prepare expands a v1-indexed directory into a completed container plus per-file children', async () => {
    // V1 booked every embedded file under the directory item's loader ids with no
    // per-file item, so its vectors were dropped on migration. When the legacy vector
    // sources are readable, the folder expands into a completed container directory plus
    // one completed file child per embedded file, so the vectors re-attribute per file.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    // Stub the legacy vector-DB read so the test needs no embedjs store on disk.
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-dir-a', '/docs/api/README.md'],
        ['loader-dir-b', '/docs/web/README.md']
      ])
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_ignore',
                    uniqueIds: ['loader-dir-a', 'loader-dir-b']
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
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    // The folder item now maps to a completed container directory with no parent.
    const containerId = migrator.legacyItemIdRemap.get('item-directory')
    const container = migrator.preparedItems.find((item: any) => item.id === containerId)
    expect(container).toMatchObject({ type: 'directory', status: 'completed', error: null, groupId: null })

    // One completed file child per embedded file, parented to the container, each with a
    // virtual relativePath (its own id) since the source is never copied into the base.
    const children = migrator.preparedItems.filter((item: any) => item.groupId === containerId)
    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child).toMatchObject({ type: 'file', status: 'completed', error: null })
      // Virtual relativePath (its own id) that never resolves to a raw/ file, so reindex admission
      // rejects it on the missing-source check (no separate flag needed).
      expect(child.data.relativePath).toBe(child.id)
    }
    const childA = children.find((c: any) => c.data.source === '/docs/api/README.md')
    const childB = children.find((c: any) => c.data.source === '/docs/web/README.md')
    expect(childA).toBeTruthy()
    expect(childB).toBeTruthy()

    // The loader → child remap is published for the vector migrator to re-attribute chunks,
    // scoped by the migrated base id so a loader id shared across bases cannot clobber.
    const baseChildLoaderRemap = migrator.directoryChildLoaderRemap.get(childA.baseId)
    expect(baseChildLoaderRemap.get('loader-dir-a')).toBe(childA.id)
    expect(baseChildLoaderRemap.get('loader-dir-b')).toBe(childB.id)
  })

  it('prepare keeps the directory child loader remap distinct across bases sharing a loader id', async () => {
    // v1 loader ids are path/content hashes with no base component, so two bases that each
    // indexed the same file path carry the same loader id. The remap must stay scoped per
    // base — otherwise the second base clobbers the first and the first base's vectors fall
    // back to the directory container and are dropped as non_indexable_container.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-shared', '/docs/shared/README.md']])
    })

    const makeBase = (baseId: string, itemId: string) => ({
      id: baseId,
      name: baseId,
      model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
      items: [
        {
          id: itemId,
          type: 'directory',
          content: '/docs',
          uniqueId: 'DirectoryLoader_ignore',
          uniqueIds: ['loader-shared']
        }
      ]
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [makeBase('kb-a', 'item-dir-a'), makeBase('kb-b', 'item-dir-b')]
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

    const baseAId = migrator.legacyBaseIdRemap.get('kb-a')
    const baseBId = migrator.legacyBaseIdRemap.get('kb-b')
    const childA = migrator.preparedItems.find((item: any) => item.type === 'file' && item.baseId === baseAId)
    const childB = migrator.preparedItems.find((item: any) => item.type === 'file' && item.baseId === baseBId)
    expect(childA.id).not.toBe(childB.id)

    // Each base keeps its own loader-shared → child mapping; no cross-base clobber.
    expect(migrator.directoryChildLoaderRemap.size).toBe(2)
    expect(migrator.directoryChildLoaderRemap.get(baseAId).get('loader-shared')).toBe(childA.id)
    expect(migrator.directoryChildLoaderRemap.get(baseBId).get('loader-shared')).toBe(childB.id)
  })

  it('prepare falls back to the directory tombstone when the legacy vectors are unreadable', async () => {
    // No loader source resolves (vector DB missing/empty), so the folder cannot expand;
    // it falls through to the shared directory mapping: `warning` + the not-migrated code
    // the UI renders as a delete-and-re-upload prompt, rather than a silently empty completed folder.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({ kind: 'loaded', sources: new Map<string, string>() })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a']
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
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    const tombstone = migrator.preparedItems.find((item: any) => item.id === migratedId)
    // A single directory item (no children synthesized), `failed` with the not-migrated code.
    expect(migrator.preparedItems.filter((item: any) => item.groupId === migratedId)).toHaveLength(0)
    expect(tombstone).toMatchObject({
      type: 'directory',
      status: 'failed',
      error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
    })
    expect(migrator.directoryChildLoaderRemap.size).toBe(0)
    // An `empty` store stays quiet — only a `read_error` warrants the base-level "unreadable" warning.
    expect(migrator.warnings.some((warning: string) => warning.includes('unreadable'))).toBe(false)
  })

  it('prepare skips the legacy vector-store read when a resolved-model base has null dimensions', async () => {
    // Gate: directory expansion reads the legacy store only when `vectorsWillMigrate` (model resolved
    // AND dimensions !== null). A resolved model whose store is unreadable yields dimensions===null, so
    // the base is kept as a `missing_vector_store` failed row and its folders stay tombstones — without
    // touching the (missing/locked) DB. A regression loosening the gate back to `kind === 'resolved'`
    // would still tombstone the folder but would needlessly read the DB (and emit a spurious read_error
    // warning when locked); only asserting loadLoaderSourceMap is never called catches that.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: null, reason: 'vector_db_empty' })
    const loadLoaderSourceMapSpy = vi
      .spyOn(migrator, 'loadLoaderSourceMap')
      .mockResolvedValue({ kind: 'loaded', sources: new Map<string, string>() })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a']
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
      },
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }])
        })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    // Gate short-circuited: the legacy vector store was never read.
    expect(loadLoaderSourceMapSpy).not.toHaveBeenCalled()

    // Base kept as a restorable missing_vector_store failure; the directory stays a tombstone with no
    // synthesized children.
    expect(migrator.preparedBases[0]).toMatchObject({
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE
    })
    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    expect(migrator.preparedItems.filter((item: any) => item.groupId === migratedId)).toHaveLength(0)
  })

  it('prepare keeps an interrupted directory as a failed item instead of expanding it', async () => {
    // A v1 directory left in `processing`/`pending`/`failed` had only some files embedded before
    // it was interrupted. Even with resolvable loader sources it must NOT expand into a fully
    // `completed` container (that would bury the interruption and hide the need to delete and re-upload); the
    // status gate makes it fall through to the shared mapping and stay `failed` with the retry message.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-dir-a', '/docs/a.md']])
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    processingStatus: 'processing',
                    uniqueId: 'DirectoryLoader_interrupted',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    const item = migrator.preparedItems.find((i: any) => i.id === migratedId)
    // Not expanded: a single failed directory item, no synthesized children, no loader remap.
    expect(migrator.preparedItems.filter((i: any) => i.groupId === migratedId)).toHaveLength(0)
    expect(item).toMatchObject({
      type: 'directory',
      status: 'failed',
      error: 'Legacy knowledge item indexing was interrupted and needs to be retried.'
    })
    expect(migrator.directoryChildLoaderRemap.size).toBe(0)
  })

  it('prepare records a warning when only some of a folder’s embedded files have migratable vectors', async () => {
    // The folder booked three embedded files but only two resolve to a source in the legacy
    // vectors. The two resolved children are correct and stay `completed`; the dropped third is
    // surfaced as a migration warning (not a container `warning`, which the child rollup would
    // revert to `completed`), so the partial loss is not silent.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-dir-a', '/docs/a.md'],
        ['loader-dir-b', '/docs/b.md']
      ])
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a', 'loader-dir-b', 'loader-dir-c']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    const containerId = migrator.legacyItemIdRemap.get('item-directory')
    expect(migrator.preparedItems.filter((i: any) => i.groupId === containerId)).toHaveLength(2)
    expect(migrator.preparedItems.find((i: any) => i.id === containerId)).toMatchObject({
      type: 'directory',
      status: 'completed',
      // The loss is surfaced as a migration warning, NOT a container `warning` status/error
      // (which the child rollup would revert to completed), so the container stays clean.
      error: null
    })
    expect(
      result.warnings?.some((warning: string) => warning.includes('re-attributed vectors for 2 of 3 embedded files'))
    ).toBe(true)
  })

  it('prepare keeps a directory tombstone and never reads legacy vectors when the embedding model is unresolved', async () => {
    // No vectors migrate for a base with an unresolved embedding model, so re-attribution is
    // skipped entirely (loadLoaderSourceMap is never read) and the folder keeps its migration-failed
    // tombstone instead of synthesizing children that would claim `completed` with nothing behind them.
    const migrator = new KnowledgeMigrator() as any
    const loadLoaderSourceMap = vi.spyOn(migrator, 'loadLoaderSourceMap')

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                dimensions: 768,
                model: { id: 'qwen', name: 'qwen', provider: 'cherryai' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'openai::text-embedding-3-small' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)
    expect(loadLoaderSourceMap).not.toHaveBeenCalled()

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    expect(migrator.preparedItems.filter((i: any) => i.groupId === migratedId)).toHaveLength(0)
    expect(migrator.preparedItems.find((i: any) => i.id === migratedId)).toMatchObject({
      type: 'directory',
      status: 'failed',
      error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
    })
  })

  it('prepare warns that a base’s folders fell back to tombstones when the legacy vectors are unreadable', async () => {
    // A read failure (e.g. a transient DB lock) is recoverable, unlike a genuinely empty store:
    // the folder keeps its tombstone, and the migration warns that a re-run once the DB is
    // readable can still recover it.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'read_error',
      sources: new Map<string, string>()
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)
    expect(result.warnings?.some((warning: string) => warning.includes('legacy vector sources were unreadable'))).toBe(
      true
    )

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    expect(migrator.preparedItems.find((i: any) => i.id === migratedId)).toMatchObject({
      type: 'directory',
      status: 'failed',
      error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
    })
  })

  it('does not emit the read_error recovery warning for a base whose only folder is not completed', async () => {
    // The "re-run can recover" message only makes sense for a `completed` folder that would have
    // expanded. A base with only an interrupted folder won't expand regardless of the read, so a
    // read failure must NOT falsely promise recovery — the folder stays `failed`, needing re-index.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'read_error',
      sources: new Map<string, string>()
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    processingStatus: 'processing',
                    uniqueId: 'DirectoryLoader_interrupted',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)
    // No completed folder → no false "re-run can recover" promise, even though the read threw.
    // Assert on the instance warnings (always an array) so the negative check can't pass
    // vacuously when `result.warnings` is undefined (it is only set when warnings exist).
    expect(migrator.warnings.some((warning: string) => warning.includes('legacy vector sources were unreadable'))).toBe(
      false
    )

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    expect(migrator.preparedItems.find((i: any) => i.id === migratedId)).toMatchObject({
      type: 'directory',
      status: 'failed'
    })
  })

  it('does not emit the read_error recovery warning when the only completed-marked folder has no id', async () => {
    // hasCompletedDirectory mirrors the expansion gate (type + id + unseen + completed). A
    // completed-marked but id-less folder is skipped (missing_id_or_type) and never expands, so a
    // read failure must not promise recovery for it — guards against the predicate drifting from
    // the gate.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'read_error',
      sources: new Map<string, string>()
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  // No `id`: completed-marked yet unexpandable.
                  {
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)
    expect(migrator.warnings.some((warning: string) => warning.includes('legacy vector sources were unreadable'))).toBe(
      false
    )
  })

  it('keeps an idle directory (loader ids but no completed marker) as idle without expanding it', async () => {
    // Expansion keys off the `completed` marker (singular `uniqueId`), not the mere presence of
    // child loader ids (plural `uniqueIds`). A folder with loader ids but no completed marker is
    // `idle`, so the gate must NOT expand it even when the loader sources resolve.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-dir-a', '/docs/a.md']])
    })

    const ctx = {
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueIds: ['loader-dir-a']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any

    const result = await migrator.prepare(ctx)
    expect(result.success).toBe(true)

    const migratedId = migrator.legacyItemIdRemap.get('item-directory')
    // Not expanded: a single idle directory item, no synthesized children, no loader remap.
    expect(migrator.preparedItems.filter((i: any) => i.groupId === migratedId)).toHaveLength(0)
    expect(migrator.preparedItems.find((i: any) => i.id === migratedId)).toMatchObject({
      type: 'directory',
      status: 'idle',
      error: null
    })
    expect(migrator.directoryChildLoaderRemap.size).toBe(0)
  })

  it('loadLoaderSourceMap returns kind=loaded with the loader→source map when the legacy vectors are readable', async () => {
    const migrator = new KnowledgeMigrator() as any
    // Delegates to the shared KnowledgeVectorSourceReader so directory expansion and vector
    // migration consume the exact same load result and path resolution.
    const vectorSource = {
      loadBase: vi.fn().mockResolvedValue({
        status: 'ok',
        dbPath: '/mock/userData/Data/KnowledgeBase/kb-ok',
        rows: [
          { uniqueLoaderId: 'loader-a', source: '/docs/a.md' },
          { uniqueLoaderId: 'loader-b', source: '/docs/b.md' },
          { uniqueLoaderId: 'loader-blank', source: '   ' },
          { uniqueLoaderId: '', source: '/docs/x.md' }
        ]
      })
    }

    const result = await migrator.loadLoaderSourceMap('kb-ok', vectorSource)
    // Blank-source and empty-loader rows are dropped; only the two usable pairs survive.
    expect(result.kind).toBe('loaded')
    expect([...result.sources.entries()]).toEqual([
      ['loader-a', '/docs/a.md'],
      ['loader-b', '/docs/b.md']
    ])
    expect(vectorSource.loadBase).toHaveBeenCalledWith('kb-ok')
  })

  it('loadLoaderSourceMap returns kind=loaded with an empty map when the legacy vector DB is missing or not embedjs', async () => {
    const migrator = new KnowledgeMigrator() as any
    for (const status of ['missing', 'invalid_path', 'directory', 'not_embedjs'] as const) {
      const vectorSource = { loadBase: vi.fn().mockResolvedValue({ status, dbPath: '/x' }) }
      const result = await migrator.loadLoaderSourceMap('kb-x', vectorSource)
      expect(result).toEqual({ kind: 'loaded', sources: new Map() })
    }
  })

  it('loadLoaderSourceMap returns kind=loaded with an empty map when the legacy vectors table has no usable rows', async () => {
    const migrator = new KnowledgeMigrator() as any
    const vectorSource = { loadBase: vi.fn().mockResolvedValue({ status: 'ok', dbPath: '/x', rows: [] }) }

    const result = await migrator.loadLoaderSourceMap('kb-empty', vectorSource)
    expect(result.kind).toBe('loaded')
    expect(result.sources.size).toBe(0)
  })

  it('loadLoaderSourceMap returns kind=read_error and logs (does not report) when the read throws', async () => {
    const migrator = new KnowledgeMigrator() as any
    const vectorSource = { loadBase: vi.fn().mockRejectedValue(new Error('database is locked')) }

    const result = await migrator.loadLoaderSourceMap('kb-read-error', vectorSource)
    expect(result.kind).toBe('read_error')
    expect(result.sources.size).toBe(0)
    // The exception detail is logged but NOT pushed to the user-facing warnings here; the caller
    // emits the actionable migration warning based on the read_error kind.
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to read legacy vector sources for knowledge base kb-read-error: database is locked'
    )
    expect(migrator.warnings).not.toContain(
      'Failed to read legacy vector sources for knowledge base kb-read-error: database is locked'
    )
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
      db: { delete: deleteMock, all: vi.fn().mockResolvedValue([]) }
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
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) },
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
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) },
      sharedData: new Map()
    } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(4)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it('execute skips file copy for synthesized directory children and keeps their virtual relativePath', async () => {
    // Synthesized directory children live at their external data.source (never copied into the
    // base), so copyKnowledgeFilesForBase must skip them: no storage-name lookup, no "missing a
    // storage name" warning, and their virtual relativePath (own id) is preserved through execute.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-dir-a', '/docs/a.md'],
        ['loader-dir-b', '/docs/b.md']
      ])
    })

    await migrator.prepare({
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase' },
      sources: {
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            bases: [
              {
                id: 'kb-dir',
                name: 'KB dir',
                model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    content: '/docs',
                    uniqueId: 'DirectoryLoader_indexed',
                    uniqueIds: ['loader-dir-a', 'loader-dir-b']
                  }
                ]
              }
            ]
          })
        },
        dexieExport: { tableExists: vi.fn().mockResolvedValue(false), readTable: vi.fn() }
      },
      db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
      }
    } as any)

    const childItems = migrator.preparedItems.filter((item: any) => item.type === 'file')
    expect(childItems).toHaveLength(2)

    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert, update: createUpdateMock() })
    })

    const executeResult = await migrator.execute({
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase', filesDataDir: '/mock/userData/Data/Files' },
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) },
      sharedData: new Map()
    } as any)

    expect(executeResult.success).toBe(true)
    // No storage-name warning for the synthesized children, and the virtual relativePath
    // (each child's own id) is preserved — the copy/dedup pass was skipped for them.
    expect(migrator.warnings.some((warning: string) => warning.includes('missing a storage name'))).toBe(false)
    for (const child of childItems) {
      expect(child.data.relativePath).toBe(child.id)
    }
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
    migrator.directoryChildLoaderRemap = new Map([[migratedBaseId, new Map([['loader-dir-a', 'child-a']])]])

    const values = vi.fn().mockResolvedValue(undefined)
    const insert = vi.fn().mockReturnValue({ values })
    const update = createUpdateMock()
    const transaction = vi.fn(async (callback: (tx: any) => Promise<void>) => {
      await callback({ insert, update })
    })
    const sharedData = new Map<string, unknown>()

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) },
      sharedData
    } as any)

    expect(result.success).toBe(true)
    expect(sharedData.get('knowledgeBaseIdRemap')).toEqual(new Map([['legacy-kb-1', migratedBaseId]]))
    expect(sharedData.get('knowledgeItemIdRemap')).toEqual(new Map([['legacy-note-1', migratedItemId]]))
    expect(sharedData.get(KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY)).toEqual(
      new Map([[migratedBaseId, new Map([['loader-dir-a', 'child-a']])]])
    )
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
      db: { transaction, delete: deleteMock, all: vi.fn().mockResolvedValue([]) },
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
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) },
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
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockResolvedValue([]) }
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

describe('KnowledgeMigrator file item path storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeExecCtx() {
    const sharedData = new Map<string, unknown>()
    const insertedInsideTx: unknown[] = []
    const insertedOutsideTx: unknown[] = []

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
      db: { transaction, insert: outerInsert, delete: deleteMock, all: vi.fn().mockResolvedValue([]) },
      logger,
      insertedInsideTx,
      insertedOutsideTx
    }
  }

  it('inserts file items with knowledge-owned relative paths and no file_ref rows', async () => {
    const ctx = makeExecCtx()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-a',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/a.pdf', relativePath: 'a.pdf' },
        status: 'idle'
      },
      {
        id: 'item-b',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/b.pdf', relativePath: 'b.pdf', indexedRelativePath: 'b.md' },
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

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(4)
    expect(ctx.insertedInsideTx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'item-a',
          data: { source: '/tmp/a.pdf', relativePath: 'a.pdf' }
        }),
        expect.objectContaining({
          id: 'item-b',
          data: { source: '/tmp/b.pdf', relativePath: 'b.pdf', indexedRelativePath: 'b.md' }
        })
      ])
    )
    expect(ctx.insertedOutsideTx).toHaveLength(0)
  })

  it('keeps file item remaps without requiring v2 file_entry rows', async () => {
    const ctx = makeExecCtx()

    const migrator = new KnowledgeMigrator() as any
    migrator.preparedBases = [{ id: 'kb-1', name: 'KB 1', dimensions: 512, embeddingModelId: 'openai::emb' }]
    migrator.preparedItems = [
      {
        id: 'item-survivor',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/ok.pdf', relativePath: 'ok.pdf' },
        status: 'idle'
      },
      {
        id: 'item-skipped-file-entry',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/bad.xyz', relativePath: 'bad.xyz' },
        status: 'idle'
      }
    ]
    migrator.legacyItemIdRemap = new Map([
      ['legacy-item-survivor', 'item-survivor'],
      ['legacy-item-skipped', 'item-skipped-file-entry']
    ])

    const result = await migrator.execute({ db: ctx.db, sharedData: ctx.sharedData, logger: ctx.logger } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(3)
    expect(ctx.insertedInsideTx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'item-survivor' }),
        expect.objectContaining({ id: 'item-skipped-file-entry' })
      ])
    )
    expect(ctx.sharedData.get('knowledgeItemIdRemap')).toEqual(
      new Map([
        ['legacy-item-survivor', 'item-survivor'],
        ['legacy-item-skipped', 'item-skipped-file-entry']
      ])
    )
    expect(ctx.insertedOutsideTx).toHaveLength(0)
  })
})
