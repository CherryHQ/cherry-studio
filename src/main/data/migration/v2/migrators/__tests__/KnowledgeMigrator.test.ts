import fs from 'node:fs'

import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assertSafeKnowledgeRelativePath, CHERRY_META_DIR } from '@main/features/knowledge'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
} from '@shared/data/types/knowledge'

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

vi.mock('better-sqlite3', () => ({
  default: vi.fn()
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

    const get = vi.fn().mockReturnValueOnce({ total: 10, with_vector: 10 }).mockReturnValueOnce({ bytes: 4096 })
    const close = vi.fn()
    const prepare = vi.fn(() => ({ get }))
    const databaseMock = Database as unknown as { mockImplementation: (value: () => unknown) => void }
    databaseMock.mockImplementation(function DatabaseMock() {
      return { prepare, close }
    })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-legacy',
        name: 'Legacy KB',
        dimensions: 768
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: 1024, reason: 'ok' })
    expect(get).toHaveBeenCalledTimes(2)
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
    expect(Database).not.toHaveBeenCalled()
  })

  it('returns vector_db_empty when vectors table has no rows', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-empty')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const get = vi.fn().mockReturnValueOnce({ total: 0, with_vector: null })
    const close = vi.fn()
    const prepare = vi.fn(() => ({ get }))
    const databaseMock = Database as unknown as { mockImplementation: (value: () => unknown) => void }
    databaseMock.mockImplementation(function DatabaseMock() {
      return { prepare, close }
    })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-empty',
        name: 'Empty KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'vector_db_empty' })
    expect(get).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns invalid_vector_dimensions when vector byte length is invalid', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-invalid')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const get = vi.fn().mockReturnValueOnce({ total: 1, with_vector: 1 }).mockReturnValueOnce({ bytes: 3 })
    const close = vi.fn()
    const prepare = vi.fn(() => ({ get }))
    const databaseMock = Database as unknown as { mockImplementation: (value: () => unknown) => void }
    databaseMock.mockImplementation(function DatabaseMock() {
      return { prepare, close }
    })

    const result = await migrator.resolveDimensionsForBase(
      {
        id: 'kb-invalid',
        name: 'Invalid KB'
      },
      '/mock/userData/Data/KnowledgeBase'
    )

    expect(result).toEqual({ dimensions: null, reason: 'invalid_vector_dimensions' })
    expect(get).toHaveBeenCalledTimes(2)
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
    expect(Database).not.toHaveBeenCalled()
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
    expect(Database).not.toHaveBeenCalled()
  })

  it('records a warning when closing the legacy vector DB client fails', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-close-error')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const get = vi.fn().mockReturnValueOnce({ total: 10, with_vector: 10 }).mockReturnValueOnce({ bytes: 4096 })
    const close = vi.fn().mockImplementation(() => {
      throw new Error('close failed')
    })
    const prepare = vi.fn(() => ({ get }))
    const databaseMock = Database as unknown as { mockImplementation: (value: () => unknown) => void }
    databaseMock.mockImplementation(function DatabaseMock() {
      return { prepare, close }
    })

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

  it('returns vector_db_error when opening the legacy vector DB throws synchronously', async () => {
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'getLegacyKnowledgeDbPath').mockReturnValue('/mock/userData/Data/KnowledgeBase/kb-create-error')

    const existsSyncMock = fs.existsSync as unknown as { mockReturnValue: (value: boolean) => void }
    existsSyncMock.mockReturnValue(true)

    const statSyncMock = fs.statSync as unknown as { mockReturnValue: (value: unknown) => void }
    statSyncMock.mockReturnValue({
      isDirectory: () => false
    })

    const databaseMock = Database as unknown as { mockImplementation: (value: () => never) => void }
    databaseMock.mockImplementation(function DatabaseMock() {
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
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockReturnValue({
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
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockReturnValue({
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

    // The folder item now maps to a completed container directory with no parent, owning a
    // top-level raw/ prefix the same way a native directory expansion does.
    const containerId = migrator.legacyItemIdRemap.get('item-directory')
    const container = migrator.preparedItems.find((item: any) => item.id === containerId)
    expect(container).toMatchObject({
      type: 'directory',
      status: 'completed',
      error: null,
      groupId: null,
      data: { source: '/docs', relativePath: 'docs' }
    })

    // One completed file child per embedded file, parented to the container, each named by its
    // path under the folder. The path is shaped like a real one but is not backed by bytes —
    // nothing is copied into raw/, so reindex admission still rejects it on the missing-source
    // check (no separate flag needed).
    const children = migrator.preparedItems.filter((item: any) => item.groupId === containerId)
    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child).toMatchObject({ type: 'file', status: 'completed', error: null })
    }
    const childA = children.find((c: any) => c.data.source === '/docs/api/README.md')
    const childB = children.find((c: any) => c.data.source === '/docs/web/README.md')
    expect(childA.data.relativePath).toBe('docs/api/README.md')
    expect(childB.data.relativePath).toBe('docs/web/README.md')

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
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockReturnValue({ dimensions: null, reason: 'vector_db_empty' })
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
    // Delegates to the shared KnowledgeVectorSourceReader's column-projected loadBaseLoaderSources
    // so directory expansion and vector migration share the same path resolution + loader set,
    // without this pass reading/decoding the vectors themselves.
    const vectorSource = {
      loadBaseLoaderSources: vi.fn().mockResolvedValue({
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
    expect(vectorSource.loadBaseLoaderSources).toHaveBeenCalledWith('kb-ok')
  })

  it('loadLoaderSourceMap returns kind=loaded with an empty map when the legacy vector DB is missing or not embedjs', async () => {
    const migrator = new KnowledgeMigrator() as any
    for (const status of ['missing', 'invalid_path', 'directory', 'not_embedjs'] as const) {
      const vectorSource = { loadBaseLoaderSources: vi.fn().mockResolvedValue({ status, dbPath: '/x' }) }
      const result = await migrator.loadLoaderSourceMap('kb-x', vectorSource)
      expect(result).toEqual({ kind: 'loaded', sources: new Map() })
    }
  })

  it('loadLoaderSourceMap returns kind=loaded with an empty map when the legacy vectors table has no usable rows', async () => {
    const migrator = new KnowledgeMigrator() as any
    const vectorSource = { loadBaseLoaderSources: vi.fn().mockResolvedValue({ status: 'ok', dbPath: '/x', rows: [] }) }

    const result = await migrator.loadLoaderSourceMap('kb-empty', vectorSource)
    expect(result.kind).toBe('loaded')
    expect(result.sources.size).toBe(0)
  })

  it('loadLoaderSourceMap returns kind=read_error and logs (does not report) when the read throws', async () => {
    const migrator = new KnowledgeMigrator() as any
    const vectorSource = { loadBaseLoaderSources: vi.fn().mockRejectedValue(new Error('database is locked')) }

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
    const where = vi.fn().mockReturnValue({ run: vi.fn() })
    const deleteMock = vi.fn().mockReturnValue({ where })
    return Object.assign(deleteMock, { where })
  }

  function createUpdateMock() {
    const where = vi.fn().mockReturnValue({ run: vi.fn() })
    const set = vi.fn().mockReturnValue({ where })
    const update = vi.fn().mockReturnValue({ set })
    return Object.assign(update, { set, where })
  }

  it('execute returns success immediately when nothing prepared', async () => {
    const migrator = new KnowledgeMigrator()
    const deleteMock = createDeleteMock()

    const result = await migrator.execute({
      db: { delete: deleteMock, all: vi.fn().mockReturnValue([]) }
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

    const values = vi.fn().mockReturnValue({
      run: vi.fn(() => {
        throw new Error('insert failed')
      })
    })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) },
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
        status: 'processing'
      },
      {
        id: 'item-2',
        baseId: 'kb-2',
        groupId: null,
        type: 'note',
        data: { content: 'n2' },
        status: 'processing'
      }
    ]

    const values = vi.fn().mockReturnValue({ run: vi.fn() })
    const insert = vi.fn().mockReturnValue({ values })
    const update = createUpdateMock()
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) },
      sharedData: new Map()
    } as any)

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(4)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it('execute skips file copy for synthesized directory children and preserves their expansion relativePath', async () => {
    // Synthesized directory children live at their external data.source (never copied into the
    // base), so copyKnowledgeFilesForBase must skip them: no storage-name lookup, no "missing a
    // storage name" warning, and the `<prefix>/<subpath>` settled during expansion survives
    // execute untouched (re-running the copy pass would rewrite it with base-wide dedup).
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
    const relativePathsBeforeExecute = childItems.map((child: any) => child.data.relativePath)
    expect(relativePathsBeforeExecute).toEqual(['docs/a.md', 'docs/b.md'])

    const values = vi.fn().mockReturnValue({ run: vi.fn() })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update: createUpdateMock() })
    })

    const executeResult = await migrator.execute({
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase', filesDataDir: '/mock/userData/Data/Files' },
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) },
      sharedData: new Map()
    } as any)

    expect(executeResult.success).toBe(true)
    // No storage-name warning for the synthesized children, and execute left their relativePath
    // exactly as expansion settled it — the copy/dedup pass was skipped for them.
    expect(migrator.warnings.some((warning: string) => warning.includes('missing a storage name'))).toBe(false)
    expect(childItems.map((child: any) => child.data.relativePath)).toEqual(relativePathsBeforeExecute)
  })

  // A migrated folder pins `raw/<prefix>` in prepare and can never move it, so anything named
  // later has to yield. The tests below pin that ordering down from both sides.
  const directoryPrefixCtx = (
    bases: unknown[],
    dexieFiles: Array<Record<string, unknown>> = []
  ): Record<string, unknown> => ({
    paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase', filesDataDir: '/mock/userData/Data/Files' },
    sources: {
      reduxState: { getCategory: vi.fn().mockReturnValue({ bases }) },
      dexieExport: {
        tableExists: vi.fn(async (name: string) => name === 'files' && dexieFiles.length > 0),
        readTable: vi.fn(),
        createStreamReader: vi.fn(() => ({
          readInBatches: vi.fn(async (_size: number, cb: (rows: unknown[]) => Promise<void>) => {
            await cb(dexieFiles)
          })
        }))
      }
    },
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([{ id: 'silicon::BAAI/bge-m3' }]) })
    }
  })

  const runExecute = async (migrator: any) =>
    migrator.execute({
      paths: { knowledgeBaseDir: '/mock/userData/Data/KnowledgeBase', filesDataDir: '/mock/userData/Data/Files' },
      db: {
        transaction: vi.fn((callback: (tx: any) => void) => {
          callback({
            insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
            update: createUpdateMock()
          })
        }),
        delete: createDeleteMock(),
        all: vi.fn().mockReturnValue([])
      },
      sharedData: new Map()
    } as any)

  const legacyBase = (overrides: Record<string, unknown>) => ({
    name: 'KB dir',
    model: { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', provider: 'silicon' },
    ...overrides
  })

  it('execute returns only its own warnings so the engine merge does not duplicate them', async () => {
    // MigrationEngine concatenates prepare().warnings with execute().warnings, and the completion
    // dialog renders the result un-deduped and un-truncated. Returning the full `this.warnings`
    // from execute therefore lists every prepare warning twice.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      // Recorded outside the container's folder — triggers prepare's aggregated fallback warning.
      sources: new Map([['loader-a', '/elsewhere/a.md']])
    })

    const prepareResult = await migrator.prepare(
      directoryPrefixCtx(
        [
          legacyBase({
            id: 'kb-dir',
            items: [
              { id: 'item-directory', type: 'directory', content: '/docs', uniqueId: 'd', uniqueIds: ['loader-a'] },
              { id: 'item-file', type: 'file', content: 'file-doc' }
            ]
          })
        ],
        [
          {
            id: 'file-doc',
            name: 'file-doc.pdf',
            origin_name: 'report.pdf',
            path: '/legacy/report.pdf',
            size: 8,
            ext: '.pdf',
            type: 'document',
            created_at: '2025-01-01T00:00:00.000Z',
            count: 1
          }
        ]
      ) as any
    )

    // `existsSync` is reset to falsy in beforeEach, so the copy pass warns as well.
    const executeResult = await runExecute(migrator)

    const prepareWarnings: string[] = prepareResult.warnings ?? []
    const executeWarnings: string[] = executeResult.warnings ?? []
    expect(prepareWarnings.some((warning) => warning.includes('outside the folder path'))).toBe(true)
    expect(executeWarnings.some((warning) => warning.includes('Knowledge file source missing'))).toBe(true)
    // The prepare-phase warning must not come back a second time from execute.
    expect(executeWarnings.some((warning) => warning.includes('outside the folder path'))).toBe(false)

    const merged = [...prepareWarnings, ...executeWarnings]
    expect(new Set(merged).size).toBe(merged.length)
  })

  it('execute keeps a copied file from claiming a migrated directory prefix', async () => {
    // A v1 file literally named `docs` would otherwise own `raw/docs` — and then deleting or
    // re-indexing the `docs` container would recursively remove it, since both paths call
    // removeDir(raw/docs). The folder keeps its prefix; the file takes `_1`.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-a', '/docs/a.md']])
    })

    await migrator.prepare(
      directoryPrefixCtx(
        [
          legacyBase({
            id: 'kb-dir',
            items: [
              { id: 'item-directory', type: 'directory', content: '/docs', uniqueId: 'd', uniqueIds: ['loader-a'] },
              { id: 'item-file', type: 'file', content: 'file-docs' }
            ]
          })
        ],
        [
          {
            id: 'file-docs',
            name: 'file-docs',
            origin_name: 'docs',
            path: '/legacy/docs',
            size: 8,
            ext: '',
            type: 'document',
            created_at: '2025-01-01T00:00:00.000Z',
            count: 1
          }
        ]
      ) as any
    )
    expect(await runExecute(migrator)).toMatchObject({ success: true })

    const container = migrator.preparedItems.find((item: any) => item.type === 'directory')
    const fileItem = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('item-file'))
    expect(container.data.relativePath).toBe('docs')
    expect(fileItem.data.relativePath).toBe('docs_1')
  })

  it('execute keeps a processed-artifact slot from claiming a migrated directory prefix', async () => {
    // With a file processor configured, `docs.pdf` also reserves its prospective `docs.md`
    // output — which the folder prefix already owns, so the pdf shifts to `docs_1.pdf`.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-a', '/x/docs.md/a.md']])
    })

    await migrator.prepare(
      directoryPrefixCtx(
        [
          legacyBase({
            id: 'kb-dir',
            preprocessProvider: { type: 'preprocess', provider: { id: 'mineru' } },
            items: [
              {
                id: 'item-directory',
                type: 'directory',
                content: '/x/docs.md',
                uniqueId: 'd',
                uniqueIds: ['loader-a']
              },
              { id: 'item-file', type: 'file', content: 'file-pdf' }
            ]
          })
        ],
        [
          {
            id: 'file-pdf',
            name: 'file-pdf.pdf',
            origin_name: 'docs.pdf',
            path: '/legacy/docs.pdf',
            size: 8,
            ext: '.pdf',
            type: 'document',
            created_at: '2025-01-01T00:00:00.000Z',
            count: 1
          }
        ]
      ) as any
    )
    expect(await runExecute(migrator)).toMatchObject({ success: true })

    const container = migrator.preparedItems.find((item: any) => item.type === 'directory')
    const fileItem = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('item-file'))
    // A folder basename is not a filename, so its `.md` suffix stays intact in the prefix.
    expect(container.data.relativePath).toBe('docs.md')
    expect(fileItem.data.relativePath).toBe('docs_1.pdf')
  })

  it('prepare dedupes folder prefixes within a base and keeps them scoped per base', async () => {
    // Two folders sharing a basename must not share a prefix — their children would then collide
    // on material.relative_path, whose UNIQUE constraint wipes the base's whole index. Across
    // bases the raw/ namespace is independent, so both may keep `docs`.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-a', '/a/docs/README.md'],
        ['loader-b', '/b/docs/README.md'],
        ['loader-c', '/c/docs/README.md']
      ])
    })

    await migrator.prepare(
      directoryPrefixCtx([
        legacyBase({
          id: 'kb-1',
          items: [
            { id: 'dir-a', type: 'directory', content: '/a/docs', uniqueId: 'd', uniqueIds: ['loader-a'] },
            { id: 'dir-b', type: 'directory', content: '/b/docs', uniqueId: 'd', uniqueIds: ['loader-b'] }
          ]
        }),
        legacyBase({
          id: 'kb-2',
          items: [{ id: 'dir-c', type: 'directory', content: '/c/docs', uniqueId: 'd', uniqueIds: ['loader-c'] }]
        })
      ]) as any
    )

    const prefixOf = (legacyId: string) =>
      migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get(legacyId)).data.relativePath
    expect(prefixOf('dir-a')).toBe('docs')
    expect(prefixOf('dir-b')).toBe('docs_1')
    expect(prefixOf('dir-c')).toBe('docs')

    // Within each base every material path stays unique.
    for (const baseId of new Set(migrator.preparedItems.map((item: any) => item.baseId))) {
      const paths = migrator.preparedItems
        .filter((item: any) => item.baseId === baseId)
        .map((item: any) => item.data.relativePath)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })

  it('prepare dedupes folder prefixes that differ only in case', async () => {
    // Distinct rows to SQLite, one directory to Windows and default macOS volumes. If both claimed
    // their literal name, deleting or re-indexing either container would `removeDir` the shared
    // `raw/` directory and take the other's bytes while its rows and index entries survived.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-a', '/a/Docs/README.md'],
        ['loader-b', '/b/docs/README.md'],
        ['loader-c', '/c/DOCS/README.md']
      ])
    })

    // The first folder is deliberately the mixed-case one: it forces the *claim* to be folded
    // when it is committed to the reserved set, not just the candidate when it is tested. With
    // only lowercase-first ordering, folding on one side alone would still pass.
    await migrator.prepare(
      directoryPrefixCtx([
        legacyBase({
          id: 'kb-1',
          items: [
            { id: 'dir-a', type: 'directory', content: '/a/Docs', uniqueId: 'd', uniqueIds: ['loader-a'] },
            { id: 'dir-b', type: 'directory', content: '/b/docs', uniqueId: 'd', uniqueIds: ['loader-b'] },
            { id: 'dir-c', type: 'directory', content: '/c/DOCS', uniqueId: 'd', uniqueIds: ['loader-c'] }
          ]
        })
      ]) as any
    )

    const prefixOf = (legacyId: string) =>
      migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get(legacyId)).data.relativePath
    // Original casing is preserved for display; only the occupancy test folds.
    expect(prefixOf('dir-a')).toBe('Docs')
    expect(prefixOf('dir-b')).toBe('docs_1')
    expect(prefixOf('dir-c')).toBe('DOCS_2')

    const folded = migrator.preparedItems.map((item: any) => item.data.relativePath.toLowerCase())
    expect(new Set(folded).size).toBe(folded.length)
  })

  it('execute keeps the prefix reserved when the v1 file is listed before its folder', async () => {
    // The seeding pass must scan every directory item up front, not rely on the copy loop reaching
    // the folder first. v1 `items` is user insertion order, so the file legitimately comes first —
    // and if the file won `raw/docs`, deleting or re-indexing the folder would removeDir its bytes.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-a', '/docs/a.md']])
    })

    await migrator.prepare(
      directoryPrefixCtx(
        [
          legacyBase({
            id: 'kb-dir',
            items: [
              { id: 'item-file', type: 'file', content: 'file-docs' },
              { id: 'item-directory', type: 'directory', content: '/docs', uniqueId: 'd', uniqueIds: ['loader-a'] }
            ]
          })
        ],
        [
          {
            id: 'file-docs',
            name: 'file-docs',
            origin_name: 'docs',
            path: '/legacy/docs',
            size: 8,
            ext: '',
            type: 'document',
            created_at: '2025-01-01T00:00:00.000Z',
            count: 1
          }
        ]
      ) as any
    )
    expect(await runExecute(migrator)).toMatchObject({ success: true })

    const container = migrator.preparedItems.find((item: any) => item.type === 'directory')
    const fileItem = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('item-file'))
    expect(container.data.relativePath).toBe('docs')
    expect(fileItem.data.relativePath).toBe('docs_1')
  })

  it('prepare yields the reserved meta dir to a v1 folder literally named .cherry', async () => {
    // `.cherry` is the control dir sibling to `raw/`, and assertSafeKnowledgeRelativePath rejects
    // it as a material path — so an unseeded set would emit a relativePath that throws on every
    // read (getKnowledgeBaseFilePath sits on reindex admission, restore filtering and preview).
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([['loader-a', '/.cherry/a.md']])
    })

    await migrator.prepare(
      directoryPrefixCtx([
        legacyBase({
          id: 'kb-dir',
          items: [
            { id: 'item-directory', type: 'directory', content: '/.cherry', uniqueId: 'd', uniqueIds: ['loader-a'] }
          ]
        })
      ]) as any
    )

    const container = migrator.preparedItems.find((item: any) => item.type === 'directory')
    expect(container.data.relativePath).toBe(`${CHERRY_META_DIR}_1`)
    for (const item of migrator.preparedItems) {
      expect(() => assertSafeKnowledgeRelativePath(item.data.relativePath)).not.toThrow()
    }
  })

  it('execute yields the reserved meta dir to a v1 file literally named .cherry', async () => {
    // Same hazard on the copy side: `raw/.cherry` would collide with the control dir itself.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })

    await migrator.prepare(
      directoryPrefixCtx(
        [legacyBase({ id: 'kb-file', items: [{ id: 'item-file', type: 'file', content: 'file-cherry' }] })],
        [
          {
            id: 'file-cherry',
            name: 'file-cherry',
            origin_name: CHERRY_META_DIR,
            path: '/legacy/.cherry',
            size: 8,
            ext: '',
            type: 'document',
            created_at: '2025-01-01T00:00:00.000Z',
            count: 1
          }
        ]
      ) as any
    )
    expect(await runExecute(migrator)).toMatchObject({ success: true })

    const fileItem = migrator.preparedItems.find((item: any) => item.id === migrator.legacyItemIdRemap.get('item-file'))
    expect(fileItem.data.relativePath).toBe(`${CHERRY_META_DIR}_1`)
    expect(() => assertSafeKnowledgeRelativePath(fileItem.data.relativePath)).not.toThrow()
  })

  it('prepare records one aggregated warning per folder for sources outside the folder path', async () => {
    // One warning per container, not per child: warnings are an unbounded array rendered in
    // full to the user at the end of migration.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-a', '/docs/a.md'],
        ['loader-b', '/elsewhere/b.md'],
        ['loader-c', '/elsewhere/c.md']
      ])
    })

    await migrator.prepare(
      directoryPrefixCtx([
        legacyBase({
          id: 'kb-dir',
          items: [
            {
              id: 'item-directory',
              type: 'directory',
              content: '/docs',
              uniqueId: 'd',
              uniqueIds: ['loader-a', 'loader-b', 'loader-c']
            }
          ]
        })
      ]) as any
    )

    const outsideWarnings = migrator.warnings.filter((warning: string) =>
      warning.includes('recorded a v1 source outside the folder path')
    )
    expect(outsideWarnings).toHaveLength(1)
    expect(outsideWarnings[0]).toContain('2 embedded file(s)')
  })

  it('prepare does not report a drop when a folder booked the same loader id twice', async () => {
    // Expansion mints one child per *distinct* loader id, so the "re-attributed N of M" count must
    // dedupe too — otherwise a repeated id reads as a file whose vectors were dropped, and the
    // warning tells the user to re-index a folder that migrated completely.
    const migrator = new KnowledgeMigrator() as any
    vi.spyOn(migrator, 'resolveDimensionsForBase').mockResolvedValue({ dimensions: 1024, reason: 'ok' })
    vi.spyOn(migrator, 'loadLoaderSourceMap').mockResolvedValue({
      kind: 'loaded',
      sources: new Map([
        ['loader-a', '/docs/a.md'],
        ['loader-b', '/docs/b.md']
      ])
    })

    await migrator.prepare(
      directoryPrefixCtx([
        legacyBase({
          id: 'kb-dir',
          items: [
            {
              id: 'item-directory',
              type: 'directory',
              content: '/docs',
              uniqueId: 'd',
              uniqueIds: ['loader-a', 'loader-a', 'loader-b']
            }
          ]
        })
      ]) as any
    )

    const children = migrator.preparedItems.filter((item: any) => item.type === 'file')
    expect(children.map((child: any) => child.data.relativePath)).toEqual(['docs/a.md', 'docs/b.md'])
    expect(migrator.warnings.some((warning: string) => warning.includes('re-attributed vectors'))).toBe(false)
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
        status: 'processing',
        error: null
      }
    ]
    migrator.legacyBaseIdRemap = new Map([['legacy-kb-1', migratedBaseId]])
    migrator.legacyItemIdRemap = new Map([['legacy-note-1', migratedItemId]])
    migrator.directoryChildLoaderRemap = new Map([[migratedBaseId, new Map([['loader-dir-a', 'child-a']])]])

    const values = vi.fn().mockReturnValue({ run: vi.fn() })
    const insert = vi.fn().mockReturnValue({ values })
    const update = createUpdateMock()
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update })
    })
    const sharedData = new Map<string, unknown>()

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) },
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

    const values = vi.fn().mockReturnValue({ run: vi.fn() })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update: createUpdateMock() })
    })
    const deleteMock = createDeleteMock()

    const result = await migrator.execute({
      db: { transaction, delete: deleteMock, all: vi.fn().mockReturnValue([]) },
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
        documentCount: null,
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
        status: 'processing',
        error: null,
        createdAt: 1775114958369,
        updatedAt: 1775114958369
      }
    ]

    const insertedValues: unknown[] = []
    const values = vi.fn((value: unknown) => {
      insertedValues.push(value)
      return { run: vi.fn() }
    })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) },
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
          status: 'processing'
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
        status: 'processing'
      },
      {
        id: 'item-2',
        baseId: 'kb-2',
        groupId: null,
        type: 'note',
        data: { content: 'n2' },
        status: 'processing'
      }
    ]

    const values = vi
      .fn()
      .mockReturnValueOnce({ run: vi.fn() })
      .mockReturnValueOnce({ run: vi.fn() })
      .mockReturnValueOnce({
        run: vi.fn(() => {
          throw new Error('second base failed')
        })
      })
    const insert = vi.fn().mockReturnValue({ values })
    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert, update: createUpdateMock() })
    })

    const result = await migrator.execute({
      db: { transaction, delete: createDeleteMock(), all: vi.fn().mockReturnValue([]) }
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
          get: vi.fn().mockReturnValue({ count: 2 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 3 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue({ count: 1 })
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
          get: vi.fn().mockReturnValue({ count: 1 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 6 })
        })
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue({ count: 0 })
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
        values: vi.fn((rows: unknown) => {
          const arr = Array.isArray(rows) ? rows : [rows]
          bucket.push(...arr)
          return { run: vi.fn() }
        })
      }))

    const outerInsert = makeInsertFn(insertedOutsideTx)
    const txInsert = makeInsertFn(insertedInsideTx)
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) })
    })
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) })

    const transaction = vi.fn((callback: (tx: any) => void) => {
      callback({ insert: txInsert, update })
    })

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    return {
      sharedData,
      db: { transaction, insert: outerInsert, delete: deleteMock, all: vi.fn().mockReturnValue([]) },
      logger,
      insertedInsideTx,
      insertedOutsideTx
    }
  }

  it('inserts file items with knowledge-owned relative paths and no FileManager refs', async () => {
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
        status: 'processing'
      },
      {
        id: 'item-b',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/b.pdf', relativePath: 'b.pdf', indexedRelativePath: 'b.md' },
        status: 'processing'
      },
      {
        id: 'item-note',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'some note', content: 'some note' },
        status: 'processing'
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
        status: 'processing'
      },
      {
        id: 'item-skipped-file-entry',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: { source: '/tmp/bad.xyz', relativePath: 'bad.xyz' },
        status: 'processing'
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
