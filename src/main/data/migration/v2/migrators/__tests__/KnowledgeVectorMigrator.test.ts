import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'

const { loggerWarnMock, setDataPath, getDataPathMock } = vi.hoisted(() => {
  let currentDataPath = ''

  return {
    loggerWarnMock: vi.fn(),
    setDataPath: (nextPath: string) => {
      currentDataPath = nextPath
    },
    getDataPathMock: vi.fn(() => currentDataPath)
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

vi.mock('@main/utils', () => ({
  getDataPath: getDataPathMock
}))

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (value: string) => value
}))

const { KnowledgeVectorMigrator } = await import('../KnowledgeVectorMigrator')

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-vector-migrator-'))
}

async function createMainDb(): Promise<{ db: DbType; close: () => void }> {
  const client = createClient({ url: 'file::memory:' })
  const db = drizzle(client)

  await db.run(
    sql.raw(`
    CREATE TABLE knowledge_base (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      dimensions INTEGER NOT NULL,
      embeddingModelId TEXT NOT NULL,
      rerankModelId TEXT,
      fileProcessorId TEXT,
      chunkSize INTEGER,
      chunkOverlap INTEGER,
      threshold REAL,
      documentCount INTEGER,
      searchMode TEXT,
      hybridAlpha REAL,
      createdAt INTEGER,
      updatedAt INTEGER
    )
  `)
  )

  await db.run(
    sql.raw(`
    CREATE TABLE knowledge_item (
      id TEXT PRIMARY KEY,
      baseId TEXT NOT NULL,
      groupId TEXT,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      createdAt INTEGER,
      updatedAt INTEGER
    )
  `)
  )

  return {
    db,
    close: () => client.close()
  }
}

async function insertKnowledgeBaseRow(
  db: DbType,
  row: {
    id: string
    name: string
    dimensions: number
    embeddingModelId: string
  }
) {
  await db.run(
    sql.raw(`
      INSERT INTO knowledge_base (id, name, dimensions, embeddingModelId)
      VALUES ('${row.id}', '${row.name}', ${row.dimensions}, '${row.embeddingModelId}')
    `)
  )
}

async function insertKnowledgeItemRow(
  db: DbType,
  row: {
    id: string
    baseId: string
    type: string
    data: unknown
    status: string
  }
) {
  await db.run(
    sql.raw(`
      INSERT INTO knowledge_item (id, baseId, groupId, type, data, status)
      VALUES ('${row.id}', '${row.baseId}', NULL, '${row.type}', '${JSON.stringify(row.data).replace(/'/g, "''")}', '${row.status}')
    `)
  )
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

function createMigrationCtx(db: DbType, reduxData: Record<string, unknown>) {
  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: new ReduxStateReader(reduxData),
      dexieExport: {} as any,
      dexieSettings: {} as any,
      localStorage: {} as any
    },
    db,
    sharedData: new Map<string, unknown>(),
    logger: {} as any
  }
}

describe('KnowledgeVectorMigrator', () => {
  let tempRoot: string
  let knowledgeBaseDir: string
  let db: DbType
  let closeDb: (() => void) | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    tempRoot = createTempRoot()
    knowledgeBaseDir = path.join(tempRoot, 'KnowledgeBase')
    fs.mkdirSync(knowledgeBaseDir, { recursive: true })
    setDataPath(tempRoot)

    const mainDb = await createMainDb()
    db = mainDb.db
    closeDb = mainDb.close
  })

  afterEach(() => {
    closeDb?.()
    closeDb = undefined
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('prepare uses uniqueIds first, falls back to uniqueId, and records warnings for unmapped vectors', async () => {
    await insertKnowledgeBaseRow(db, {
      id: 'kb-1',
      name: 'Base 1',
      dimensions: 2,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    await insertKnowledgeItemRow(db, {
      id: 'item-file',
      baseId: 'kb-1',
      type: 'file',
      data: {
        file: {
          id: 'file-1',
          name: 'file-1.md',
          origin_name: 'file-1.md',
          path: '/tmp/file-1.md',
          size: 1,
          ext: '.md',
          type: 'text',
          created_at: '2024-01-01T00:00:00.000Z',
          count: 1
        }
      },
      status: 'completed'
    })
    await insertKnowledgeItemRow(db, {
      id: 'item-directory',
      baseId: 'kb-1',
      type: 'directory',
      data: { path: '/tmp/dir', recursive: true },
      status: 'completed'
    })

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

    const migrationCtx = createMigrationCtx(db, {
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

  it('execute rebuilds vector rows with uuid v4 ids, externalId item ids, and metadata.source only', async () => {
    await insertKnowledgeBaseRow(db, {
      id: 'kb-1',
      name: 'Base 1',
      dimensions: 2,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    await insertKnowledgeItemRow(db, {
      id: 'item-file',
      baseId: 'kb-1',
      type: 'file',
      data: {
        file: {
          id: 'file-1',
          name: 'file-1.md',
          origin_name: 'file-1.md',
          path: '/tmp/file-1.md',
          size: 1,
          ext: '.md',
          type: 'text',
          created_at: '2024-01-01T00:00:00.000Z',
          count: 1
        }
      },
      status: 'completed'
    })

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

    const migrationCtx = createMigrationCtx(db, {
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
    expect(row.collection).toBe('')
    expect(row.document).toBe('file chunk')
    expect(JSON.parse(String(row.metadata))).toEqual({ source: '/tmp/file-1.md' })
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

  it('execute skips failed bases and validate treats them as skipped', async () => {
    await insertKnowledgeBaseRow(db, {
      id: 'kb-1',
      name: 'Base 1',
      dimensions: 2,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    await insertKnowledgeItemRow(db, {
      id: 'item-file',
      baseId: 'kb-1',
      type: 'file',
      data: {
        file: {
          id: 'file-1',
          name: 'file-1.md',
          origin_name: 'file-1.md',
          path: '/tmp/file-1.md',
          size: 1,
          ext: '.md',
          type: 'text',
          created_at: '2024-01-01T00:00:00.000Z',
          count: 1
        }
      },
      status: 'completed'
    })

    await createLegacyVectorDb(path.join(knowledgeBaseDir, 'kb-1'), [
      {
        id: 'legacy-file-0',
        pageContent: 'file chunk',
        uniqueLoaderId: 'loader-file',
        source: '/tmp/file-1.md',
        vector: [1, 2]
      }
    ])

    const migrationCtx = createMigrationCtx(db, {
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
    })

    const migrator = new KnowledgeVectorMigrator() as any
    const prepareResult = await migrator.prepare(migrationCtx as any)
    expect(prepareResult.success).toBe(true)

    vi.spyOn(migrator, 'insertVectorRows').mockRejectedValueOnce(new Error('insert failed'))

    const executeResult = await migrator.execute(migrationCtx as any)
    expect(executeResult.success).toBe(true)
    expect(executeResult.processedCount).toBe(0)

    const validateResult = await migrator.validate(migrationCtx as any)
    expect(validateResult.success).toBe(true)
    expect(validateResult.stats).toMatchObject({
      sourceCount: 1,
      targetCount: 0,
      skippedCount: 1
    })
  })
})
