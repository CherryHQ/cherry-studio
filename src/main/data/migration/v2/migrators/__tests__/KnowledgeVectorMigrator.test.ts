import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeVectorSourceReader } from '../../utils/KnowledgeVectorSourceReader'
import { ReduxStateReader } from '../../utils/ReduxStateReader'

const { loggerWarnMock, setKnowledgeBaseRoot, getPathMock } = vi.hoisted(() => {
  let currentKnowledgeBaseRoot = ''

  return {
    loggerWarnMock: vi.fn(),
    setKnowledgeBaseRoot: (nextPath: string) => {
      currentKnowledgeBaseRoot = nextPath
    },
    getPathMock: vi.fn((key: string, filename?: string) => {
      if (key !== 'feature.knowledgebase.data') {
        throw new Error(`Unexpected path key: ${key}`)
      }

      return filename ? path.join(currentKnowledgeBaseRoot, filename) : currentKnowledgeBaseRoot
    })
  }
})

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

vi.mock('node:fs', async (importOriginal) => {
  return (await importOriginal()) as any
})

vi.mock('node:os', async (importOriginal) => {
  return (await importOriginal()) as any
})

vi.mock('@application', () => ({
  application: {
    getPath: getPathMock
  }
}))

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (value: string) => value
}))

const { KnowledgeVectorMigrator } = await import('../KnowledgeVectorMigrator')

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-vector-migrator-'))
}

interface MigratedKnowledgeBaseRow {
  id: string
  dimensions: number
}

interface MigratedKnowledgeItemRow {
  id: string
  baseId: string
}

async function createLegacyVectorDb(
  dbPath: string,
  rows: Array<{
    id: string
    pageContent: string
    uniqueLoaderId: string
    source: string
    vector: number[]
  }>
) {
  const client = createClient({ url: pathToFileURL(dbPath).toString() })

  await client.execute(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      pageContent TEXT UNIQUE,
      uniqueLoaderId TEXT NOT NULL,
      source TEXT NOT NULL,
      vector F32_BLOB(2),
      metadata TEXT
    )
  `)

  for (const row of rows) {
    await client.execute({
      sql: `
        INSERT INTO vectors (id, pageContent, uniqueLoaderId, source, vector, metadata)
        VALUES (?, ?, ?, ?, vector32(?), '{}')
      `,
      args: [row.id, row.pageContent, row.uniqueLoaderId, row.source, `[${row.vector.join(',')}]`]
    })
  }

  client.close()
}

function createDbMock({
  migratedBases = [],
  migratedItems = []
}: {
  migratedBases?: MigratedKnowledgeBaseRow[]
  migratedItems?: MigratedKnowledgeItemRow[]
}) {
  const select = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn().mockResolvedValue(migratedBases)
    })
    .mockReturnValueOnce({
      from: vi.fn().mockResolvedValue(migratedItems)
    })

  return { select }
}

function createMigrationCtx({
  reduxData,
  migratedBases = [],
  migratedItems = [],
  knowledgeVectorSource = new KnowledgeVectorSourceReader()
}: {
  reduxData: Record<string, unknown>
  migratedBases?: MigratedKnowledgeBaseRow[]
  migratedItems?: MigratedKnowledgeItemRow[]
  knowledgeVectorSource?: KnowledgeVectorSourceReader
}) {
  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: {} as any,
      dexieSettings: {} as any,
      localStorage: {} as any,
      knowledgeVectorSource
    },
    db: createDbMock({ migratedBases, migratedItems }),
    sharedData: new Map<string, unknown>(),
    logger: {} as any
  }
}

describe('KnowledgeVectorMigrator', () => {
  let tempRoot: string
  let knowledgeBaseDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempRoot = createTempRoot()
    knowledgeBaseDir = path.join(tempRoot, 'KnowledgeBase')
    fs.mkdirSync(knowledgeBaseDir, { recursive: true })
    setKnowledgeBaseRoot(knowledgeBaseDir)
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('prepare uses uniqueIds first, falls back to uniqueId, and records warnings for unmapped vectors', async () => {
    await createLegacyVectorDb(path.join(knowledgeBaseDir, 'kb-1'), [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '/tmp/file-1.md',
        vector: [1, 2]
      },
      {
        id: 'legacy-dir-0',
        pageContent: 'dir chunk',
        uniqueLoaderId: 'loader-dir-a',
        source: '/tmp/dir/a.md',
        vector: [3, 4]
      },
      {
        id: 'legacy-missing-0',
        pageContent: 'missing chunk',
        uniqueLoaderId: 'loader-missing',
        source: '/tmp/missing.md',
        vector: [5, 6]
      }
    ])

    const migrationCtx = createMigrationCtx({
      migratedBases: [{ id: 'kb-1', dimensions: 2 }],
      migratedItems: [
        { id: 'item-file', baseId: 'kb-1' },
        { id: 'item-directory', baseId: 'kb-1' }
      ],
      reduxData: {
        knowledge: {
          bases: [
            {
              id: 'kb-1',
              name: 'Base 1',
              items: [
                {
                  id: 'item-file',
                  type: 'file',
                  uniqueId: 'loader-file'
                },
                {
                  id: 'item-directory',
                  type: 'directory',
                  uniqueId: 'DirectoryLoader_ignore',
                  uniqueIds: ['loader-dir-a']
                }
              ]
            }
          ]
        }
      }
    })

    const migrator = new KnowledgeVectorMigrator() as any
    const result = await migrator.prepare(migrationCtx as any)

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(3)
    expect(migrator.preparedBasePlans).toHaveLength(1)
    expect(migrator.preparedBasePlans[0].rows).toHaveLength(2)
    expect(migrator.preparedBasePlans[0].rows.map((row: any) => row.externalId)).toEqual([
      'item-file',
      'item-directory'
    ])
    expect(migrator.skippedCount).toBe(1)
    expect(result.warnings?.some((warning) => warning.includes('loader-missing'))).toBe(true)
  })

  it('does not create a vector index during schema bootstrap', async () => {
    const migrator = new KnowledgeVectorMigrator()
    const client = {
      execute: vi.fn(async () => undefined)
    }

    await expect((migrator as any).ensureVectorStoreSchema(client, 2)).resolves.toBeUndefined()

    expect(client.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('libsql_vector_idx')
      })
    )
  })

  it('hard fails when FTS schema creation fails', async () => {
    const migrator = new KnowledgeVectorMigrator()
    const client = {
      execute: vi.fn(async ({ sql: statement }: { sql: string }) => {
        if (statement.includes('CREATE VIRTUAL TABLE IF NOT EXISTS libsql_vectorstores_embedding_fts')) {
          throw new Error('fts creation failed')
        }
      })
    }

    await expect((migrator as any).ensureVectorStoreSchema(client, 2)).rejects.toThrow('fts creation failed')
  })

  it('execute rebuilds vector rows with uuid v4 ids, externalId item ids, and metadata.itemId/source', async () => {
    const dbPath = path.join(knowledgeBaseDir, 'kb-1')
    await createLegacyVectorDb(dbPath, [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '/tmp/file-1.md',
        vector: [1, 2]
      }
    ])

    const migrationCtx = createMigrationCtx({
      migratedBases: [{ id: 'kb-1', dimensions: 2 }],
      migratedItems: [{ id: 'item-file', baseId: 'kb-1' }],
      reduxData: {
        knowledge: {
          bases: [
            {
              id: 'kb-1',
              name: 'Base 1',
              items: [
                {
                  id: 'item-file',
                  type: 'file',
                  uniqueId: 'loader-file'
                }
              ]
            }
          ]
        }
      }
    })

    const migrator = new KnowledgeVectorMigrator() as any
    const prepareResult = await migrator.prepare(migrationCtx as any)
    expect(prepareResult.success).toBe(true)

    const executeResult = await migrator.execute(migrationCtx as any)
    expect(executeResult.success).toBe(true)
    expect(executeResult.processedCount).toBe(1)

    const targetClient = createClient({ url: pathToFileURL(dbPath).toString() })
    const rows = await targetClient.execute(
      'SELECT id, external_id, collection, document, metadata, length(embeddings) AS bytes FROM libsql_vectorstores_embedding'
    )
    targetClient.close()

    expect(rows.rows).toHaveLength(1)
    const row = rows.rows[0] as Record<string, unknown>
    expect(String(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(String(row.id)).not.toBe('legacy-file-0')
    expect(row.external_id).toBe('item-file')
    expect(row.collection).toBe('kb-1')
    expect(row.document).toBe('file chunk')
    expect(JSON.parse(String(row.metadata))).toEqual({
      itemId: 'item-file',
      source: '/tmp/file-1.md'
    })
    expect(Number(row.bytes)).toBeGreaterThan(0)

    const validateResult = await migrator.validate(migrationCtx as any)
    expect(validateResult.success).toBe(true)
    expect(validateResult.errors).toStrictEqual([])
    expect(validateResult.stats).toMatchObject({
      sourceCount: 1,
      targetCount: 1,
      skippedCount: 0
    })

    expect(fs.existsSync(`${dbPath}.vectorstore.tmp`)).toBe(false)
  })

  it('reports knowledge vector migration progress for each inserted batch', async () => {
    const migrator = new KnowledgeVectorMigrator() as any
    const dbPath = path.join(knowledgeBaseDir, 'kb-progress')
    const reportedProgress: number[] = []

    migrator.preparedBasePlans = [
      {
        baseId: 'kb-progress',
        dbPath,
        dimensions: 2,
        rows: Array.from({ length: 250 }, (_, index) => ({
          document: `doc-${index}`,
          externalId: `item-${index}`,
          source: `/tmp/doc-${index}.md`,
          embedding: [index, index + 1]
        })),
        sourceRowCount: 250
      }
    ]

    migrator.setProgressCallback((progress: number) => {
      reportedProgress.push(progress)
    })

    await expect(migrator.execute()).resolves.toMatchObject({
      success: true,
      processedCount: 250
    })

    expect(reportedProgress).toEqual([40, 80, 100])
    expect(fs.existsSync(dbPath)).toBe(true)
    expect(fs.existsSync(`${dbPath}.vectorstore.tmp`)).toBe(false)
  })

  it('execute allows missing legacy source and omits metadata.source', async () => {
    const dbPath = path.join(knowledgeBaseDir, 'kb-1')
    await createLegacyVectorDb(dbPath, [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '',
        vector: [1, 2]
      }
    ])

    const migrationCtx = createMigrationCtx({
      migratedBases: [{ id: 'kb-1', dimensions: 2 }],
      migratedItems: [{ id: 'item-file', baseId: 'kb-1' }],
      reduxData: {
        knowledge: {
          bases: [
            {
              id: 'kb-1',
              name: 'Base 1',
              items: [
                {
                  id: 'item-file',
                  type: 'file',
                  uniqueId: 'loader-file'
                }
              ]
            }
          ]
        }
      }
    })

    const migrator = new KnowledgeVectorMigrator() as any
    expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
    expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

    const targetClient = createClient({ url: pathToFileURL(dbPath).toString() })
    const rows = await targetClient.execute('SELECT metadata FROM libsql_vectorstores_embedding')
    targetClient.close()

    expect(rows.rows).toHaveLength(1)
    expect(JSON.parse(String((rows.rows[0] as Record<string, unknown>).metadata))).toEqual({
      itemId: 'item-file'
    })

    const validateResult = await migrator.validate(migrationCtx as any)
    expect(validateResult.success).toBe(true)
    expect(validateResult.errors).toStrictEqual([])
  })

  it('execute fails when rebuilding a base fails and does not count it as skipped', async () => {
    await createLegacyVectorDb(path.join(knowledgeBaseDir, 'kb-1'), [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '/tmp/file-1.md',
        vector: [1, 2]
      }
    ])

    const migrationCtx = createMigrationCtx({
      migratedBases: [{ id: 'kb-1', dimensions: 2 }],
      migratedItems: [{ id: 'item-file', baseId: 'kb-1' }],
      reduxData: {
        knowledge: {
          bases: [
            {
              id: 'kb-1',
              name: 'Base 1',
              items: [
                {
                  id: 'item-file',
                  type: 'file',
                  uniqueId: 'loader-file'
                }
              ]
            }
          ]
        }
      }
    })

    const migrator = new KnowledgeVectorMigrator() as any
    const prepareResult = await migrator.prepare(migrationCtx as any)
    expect(prepareResult.success).toBe(true)

    vi.spyOn(migrator, 'insertVectorRows').mockRejectedValueOnce(new Error('insert failed'))

    const executeResult = await migrator.execute(migrationCtx as any)
    expect(executeResult.success).toBe(false)
    expect(executeResult.processedCount).toBe(0)
    expect(executeResult.error).toContain('kb-1')
    expect(executeResult.error).toContain('insert failed')
    expect(migrator.skippedCount).toBe(0)
  })

  it('validate fails when migrated metadata.itemId is missing or mismatched', async () => {
    const dbPath = path.join(knowledgeBaseDir, 'kb-1')
    await createLegacyVectorDb(dbPath, [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '/tmp/file-1.md',
        vector: [1, 2]
      }
    ])

    const migrationCtx = createMigrationCtx({
      migratedBases: [{ id: 'kb-1', dimensions: 2 }],
      migratedItems: [{ id: 'item-file', baseId: 'kb-1' }],
      reduxData: {
        knowledge: {
          bases: [
            {
              id: 'kb-1',
              name: 'Base 1',
              items: [
                {
                  id: 'item-file',
                  type: 'file',
                  uniqueId: 'loader-file'
                }
              ]
            }
          ]
        }
      }
    })

    const migrator = new KnowledgeVectorMigrator() as any
    await expect(migrator.prepare(migrationCtx as any)).resolves.toMatchObject({ success: true })
    await expect(migrator.execute(migrationCtx as any)).resolves.toMatchObject({ success: true, processedCount: 1 })

    const targetClient = createClient({ url: pathToFileURL(dbPath).toString() })
    await targetClient.execute({
      sql: `UPDATE libsql_vectorstores_embedding SET metadata = ? WHERE external_id = ?`,
      args: [JSON.stringify({ source: '/tmp/file-1.md' }), 'item-file']
    })
    targetClient.close()

    const validateResult = await migrator.validate(migrationCtx as any)
    expect(validateResult.success).toBe(false)
    expect(validateResult.errors).toContainEqual(
      expect.objectContaining({
        key: 'knowledge_vector_missing_item_id_kb-1'
      })
    )
  })
})
