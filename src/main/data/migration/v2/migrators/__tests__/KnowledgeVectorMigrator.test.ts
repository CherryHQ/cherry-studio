import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { stripOkfFrontmatter } from '@main/features/knowledge/utils/sources/okfFrontmatter'
import { hashEmbeddingText } from '@main/features/knowledge/vectorstore/indexStore/hashing'
import { KnowledgeIndexStore } from '@main/features/knowledge/vectorstore/indexStore/KnowledgeIndexStore'
import { encodeVectorBlob } from '@main/features/knowledge/vectorstore/indexStore/vectorBlob'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeVectorSourceReader } from '../../utils/KnowledgeVectorSourceReader'
import { ReduxStateReader } from '../../utils/ReduxStateReader'

const { loggerWarnMock } = vi.hoisted(() => {
  return {
    loggerWarnMock: vi.fn()
  }
})

let currentKnowledgeBaseRoot = ''

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

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (value: string) => value,
  getFileExt: (filePath: string) => {
    const index = filePath.lastIndexOf('.')
    return index >= 0 ? filePath.slice(index) : ''
  }
}))

const { KnowledgeVectorMigrator } = await import('../KnowledgeVectorMigrator')

const LEGACY_KNOWLEDGE_BASE_ID = 'kb-1'
const MIGRATED_KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const MIGRATED_FILE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const MIGRATED_DIRECTORY_ITEM_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const MIGRATED_SITEMAP_URL_ITEM_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const DEFAULT_KNOWLEDGE_BASE_ID_REMAP = new Map<string, string>([
  [LEGACY_KNOWLEDGE_BASE_ID, MIGRATED_KNOWLEDGE_BASE_ID]
])
const DEFAULT_KNOWLEDGE_ITEM_ID_REMAP = new Map<string, string>([
  ['item-file', MIGRATED_FILE_ITEM_ID],
  ['item-directory', MIGRATED_DIRECTORY_ITEM_ID],
  ['item-sitemap', MIGRATED_SITEMAP_URL_ITEM_ID]
])

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-vector-migrator-'))
}

// Mirrors the runtime vector store layout in
// src/main/features/knowledge/utils/storage/pathStorage.ts: {root}/{baseId}/.cherry/index.sqlite.
// Read-back assertions use this so they fail if the migrator ever writes to a path the runtime
// would not open — the exact bug this regression guards against.
function runtimeVectorStorePath(baseId: string): string {
  return path.join(currentKnowledgeBaseRoot, baseId, '.cherry', 'index.sqlite')
}

// Mirrors the runtime material-byte layout in pathStorage.ts (MATERIAL_ROOT_DIR='raw'):
// {root}/{baseId}/raw/{relativePath}. Snapshot assertions resolve through this so a migrator that
// writes outside `raw/` (where getKnowledgeBaseFilePath would never read it) fails the test.
function runtimeMaterialPath(baseId: string, relativePath: string): string {
  return path.join(currentKnowledgeBaseRoot, baseId, 'raw', relativePath)
}

interface MigratedKnowledgeBaseRow {
  id: string
  dimensions: number
  embeddingModelId: string | null
  status: 'completed' | 'failed'
  chunkSize: number
  chunkOverlap: number
  fileProcessorId?: string | null
}

interface MigratedKnowledgeItemRow {
  id: string
  baseId: string
  type: 'file' | 'url' | 'note' | 'directory'
  data: Record<string, unknown>
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

/** Read every table the migrator writes from a rebuilt store, ordered for assertions. */
async function readStore(baseId: string) {
  const client = createClient({ url: pathToFileURL(runtimeVectorStorePath(baseId)).toString() })
  try {
    const meta = (await client.execute('SELECT base_id FROM meta')).rows
    const material = (
      await client.execute(
        'SELECT material_id, relative_path, current_content_hash FROM material ORDER BY relative_path'
      )
    ).rows
    const content = (await client.execute('SELECT content_hash, text FROM content')).rows
    const searchUnit = (
      await client.execute(
        'SELECT unit_id, material_id, unit_type, unit_index, char_start, char_end FROM search_unit ORDER BY material_id, unit_index'
      )
    ).rows
    const searchText = (
      await client.execute('SELECT target_type, kind, text, embedding_text_hash FROM search_text ORDER BY text')
    ).rows
    const embedding = (
      await client.execute('SELECT embedding_text_hash, vector_blob, length(vector_blob) AS bytes FROM embedding')
    ).rows
    return { meta, material, content, searchUnit, searchText, embedding }
  } finally {
    client.close()
  }
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

  // Captures the url-snapshot row write-backs: one entry per updated item.
  const updateCalls: Array<{ values: Record<string, unknown> }> = []
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        updateCalls.push({ values })
      })
    }))
  }))

  return { select, update, updateCalls }
}

function createMigrationCtx({
  reduxData,
  migratedBases = [],
  migratedItems = [],
  knowledgeBaseIdRemap = DEFAULT_KNOWLEDGE_BASE_ID_REMAP,
  knowledgeItemIdRemap = DEFAULT_KNOWLEDGE_ITEM_ID_REMAP,
  knowledgeVectorSource = new KnowledgeVectorSourceReader(currentKnowledgeBaseRoot)
}: {
  reduxData: Record<string, unknown>
  migratedBases?: MigratedKnowledgeBaseRow[]
  migratedItems?: MigratedKnowledgeItemRow[]
  knowledgeBaseIdRemap?: Map<string, string>
  knowledgeItemIdRemap?: Map<string, string>
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
    sharedData: new Map<string, unknown>([
      ['knowledgeBaseIdRemap', knowledgeBaseIdRemap],
      ['knowledgeItemIdRemap', knowledgeItemIdRemap]
    ]),
    logger: {} as any,
    paths: { knowledgeBaseDir: currentKnowledgeBaseRoot } as any
  }
}

function createEmptyRemapMigrationCtx(
  options: Parameters<typeof createMigrationCtx>[0]
): ReturnType<typeof createMigrationCtx> {
  return createMigrationCtx({
    ...options,
    knowledgeItemIdRemap: new Map()
  })
}

function createMissingBaseRemapMigrationCtx(
  options: Parameters<typeof createMigrationCtx>[0]
): ReturnType<typeof createMigrationCtx> {
  return createMigrationCtx({
    ...options,
    knowledgeBaseIdRemap: new Map()
  })
}

function createMigratedItem(
  id: string,
  overrides: Partial<Omit<MigratedKnowledgeItemRow, 'id'>> = {}
): MigratedKnowledgeItemRow {
  return {
    id,
    baseId: MIGRATED_KNOWLEDGE_BASE_ID,
    type: 'file',
    data: { source: `/tmp/${id}.md`, relativePath: `${id}.md` },
    ...overrides
  }
}

function createMigratedBase(overrides: Partial<MigratedKnowledgeBaseRow> = {}): MigratedKnowledgeBaseRow {
  return {
    id: MIGRATED_KNOWLEDGE_BASE_ID,
    dimensions: 2,
    embeddingModelId: 'ollama::nomic-embed-text',
    status: 'completed',
    chunkSize: 1000,
    chunkOverlap: 200,
    ...overrides
  }
}

/** A migrated item id mapped to its prepared materials (test-only reach into private state). */
function materialItemIds(migrator: any): string[] {
  return migrator.preparedBasePlans[0].materials.map((material: { itemId: string }) => material.itemId)
}

describe('KnowledgeVectorMigrator', () => {
  let tempRoot: string
  let knowledgeBaseDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempRoot = createTempRoot()
    knowledgeBaseDir = path.join(tempRoot, 'KnowledgeBase')
    fs.mkdirSync(knowledgeBaseDir, { recursive: true })
    currentKnowledgeBaseRoot = knowledgeBaseDir
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  describe('prepare', () => {
    it('uses uniqueIds first, skips container vectors, and records warnings for skipped vectors', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
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
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_FILE_ITEM_ID),
          createMigratedItem(MIGRATED_DIRECTORY_ITEM_ID, {
            type: 'directory',
            data: { source: '/tmp/dir', path: '/tmp/dir' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [
                  { id: 'item-file', type: 'file', uniqueId: 'loader-file' },
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
      expect(materialItemIds(migrator)).toEqual([MIGRATED_FILE_ITEM_ID])
      expect(migrator.skippedCount).toBe(2)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (unmapped_loader): count=1') &&
            warning.includes('loader-missing')
        )
      ).toBe(true)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (non_indexable_container): count=1') &&
            warning.includes(`container item '${MIGRATED_DIRECTORY_ITEM_ID}'`) &&
            warning.includes("type 'directory' is not indexable")
        )
      ).toBe(true)
    })

    it('skips legacy loaders that were not remapped to migrated item ids', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-file-0',
          pageContent: 'file chunk',
          uniqueLoaderId: 'loader-file',
          source: '/tmp/file-1.md',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createEmptyRemapMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans).toHaveLength(1)
      expect(migrator.preparedBasePlans[0].materials).toEqual([])
      expect(migrator.skippedCount).toBe(1)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (unmapped_loader): count=1') &&
            warning.includes('loader-file')
        )
      ).toBe(true)
    })

    it('keeps only the mapped loaders when the item id remap is partial', async () => {
      const migratedSecondItemId = '0198f3f2-7d1d-7abc-8def-123456789abc'

      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-file-0',
          pageContent: 'first file chunk',
          uniqueLoaderId: 'loader-file-a',
          source: '/tmp/file-a.md',
          vector: [1, 2]
        },
        {
          id: 'legacy-file-1',
          pageContent: 'second file chunk',
          uniqueLoaderId: 'loader-file-b',
          source: '/tmp/file-b.md',
          vector: [3, 4]
        },
        {
          id: 'legacy-file-2',
          pageContent: 'skipped file chunk',
          uniqueLoaderId: 'loader-file-c',
          source: '/tmp/file-c.md',
          vector: [5, 6]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID), createMigratedItem(migratedSecondItemId)],
        knowledgeItemIdRemap: new Map([
          ['item-file-a', MIGRATED_FILE_ITEM_ID],
          ['item-file-b', migratedSecondItemId]
        ]),
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [
                  { id: 'item-file-a', type: 'file', uniqueId: 'loader-file-a' },
                  { id: 'item-file-b', type: 'file', uniqueId: 'loader-file-b' },
                  { id: 'item-file-c', type: 'file', uniqueId: 'loader-file-c' }
                ]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans).toHaveLength(1)
      expect(materialItemIds(migrator)).toEqual([MIGRATED_FILE_ITEM_ID, migratedSecondItemId])
      expect(migrator.skippedCount).toBe(1)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (unmapped_loader): count=1') &&
            warning.includes('loader-file-c')
        )
      ).toBe(true)
    })

    it('skips migrated bases that cannot be mapped back to legacy base ids', async () => {
      const loadBase = vi.fn()
      const migrationCtx = createMissingBaseRemapMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: { loadBase } as any,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(loadBase).not.toHaveBeenCalled()
      expect(migrator.preparedBasePlans).toEqual([])
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (unmapped_base): count=1') &&
            warning.includes(MIGRATED_KNOWLEDGE_BASE_ID)
        )
      ).toBe(true)
    })

    it('migrates legacy sitemap vectors when their item migrated as url', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-sitemap-0',
          pageContent: 'sitemap page chunk',
          uniqueLoaderId: 'loader-sitemap',
          source: 'https://example.com/page',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueId: 'loader-sitemap' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans).toHaveLength(1)
      expect(materialItemIds(migrator)).toEqual([MIGRATED_SITEMAP_URL_ITEM_ID])
      // A url material is planned onto its materialized snapshot path (derived
      // from the content's first line), replacing the old virtual item-id path.
      const material = migrator.preparedBasePlans[0].materials[0].input.material
      expect(material).toMatchObject({
        relativePath: 'sitemap page chunk.md'
      })
      expect(migrator.preparedBasePlans[0].materialSnapshots).toHaveLength(1)
      expect(migrator.skippedCount).toBe(0)
      expect(result.warnings ?? []).not.toEqual(
        expect.arrayContaining([expect.stringContaining('non_indexable_container')])
      )
    })

    it('records unsupported vector encodings in a distinct warning bucket', async () => {
      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: {
          loadBase: vi.fn().mockResolvedValue({
            status: 'ok',
            dbPath: path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID),
            rows: [
              {
                pageContent: 'file chunk',
                uniqueLoaderId: 'loader-file',
                source: '/tmp/file-1.md',
                vector: { status: 'unsupported_encoding', encoding: 'string' }
              }
            ]
          })
        } as unknown as KnowledgeVectorSourceReader,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans[0].materials).toEqual([])
      expect(migrator.skippedCount).toBe(1)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (unsupported_vector_encoding): count=1') &&
            warning.includes("unsupported vector encoding 'string'") &&
            warning.includes("uniqueLoaderId 'loader-file'")
        )
      ).toBe(true)
      expect(result.warnings?.some((warning) => warning.includes('missing_vector_payload'))).toBe(false)
    })

    it('keeps missing vector payloads in the existing warning bucket', async () => {
      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: {
          loadBase: vi.fn().mockResolvedValue({
            status: 'ok',
            dbPath: path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID),
            rows: [
              {
                pageContent: 'file chunk',
                uniqueLoaderId: 'loader-file',
                source: '/tmp/file-1.md',
                vector: { status: 'missing' }
              }
            ]
          })
        } as unknown as KnowledgeVectorSourceReader,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans[0].materials).toEqual([])
      expect(migrator.skippedCount).toBe(1)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (missing_vector_payload): count=1') &&
            warning.includes("vector payload missing for uniqueLoaderId 'loader-file'")
        )
      ).toBe(true)
      expect(result.warnings?.some((warning) => warning.includes('unsupported_vector_encoding'))).toBe(false)
    })

    it('skips vectors whose length disagrees with the base dimensions', async () => {
      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase({ dimensions: 2 })],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: {
          loadBase: vi.fn().mockResolvedValue({
            status: 'ok',
            dbPath: path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID),
            rows: [
              {
                pageContent: 'file chunk',
                uniqueLoaderId: 'loader-file',
                source: '/tmp/file-1.md',
                vector: { status: 'decoded', value: [1, 2, 3] }
              }
            ]
          })
        } as unknown as KnowledgeVectorSourceReader,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(migrator.preparedBasePlans[0].materials).toEqual([])
      expect(migrator.skippedCount).toBe(1)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (dimension_mismatch): count=1') &&
            warning.includes('vector length 3 != base dimensions 2')
        )
      ).toBe(true)
    })

    it('skips failed bases without reading or rebuilding legacy vectors', async () => {
      const loadBase = vi.fn()
      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase({ embeddingModelId: null, status: 'failed' })],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: { loadBase } as any,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      const result = await migrator.prepare(migrationCtx as any)

      expect(result.success).toBe(true)
      expect(loadBase).not.toHaveBeenCalled()
      expect(migrator.preparedBasePlans).toEqual([])
      expect(
        result.warnings?.some((warning) =>
          warning.includes(
            `Skipped knowledge vector records (${KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL}): count=1`
          )
        )
      ).toBe(true)
    })

    it('keeps an unreadable legacy vector DB as a recoverable per-base skip', async () => {
      const loadBase = vi.fn().mockRejectedValueOnce(new Error('loadBase failed'))
      const migrationCtx = createMigrationCtx({
        migratedBases: [
          createMigratedBase({ id: '22222222-2222-4222-8222-222222222222', embeddingModelId: null, status: 'failed' }),
          createMigratedBase({ id: '33333333-3333-4333-8333-333333333333' })
        ],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID, { baseId: '33333333-3333-4333-8333-333333333333' })],
        knowledgeBaseIdRemap: new Map([
          ['kb-missing-model', '22222222-2222-4222-8222-222222222222'],
          ['kb-load-fails', '33333333-3333-4333-8333-333333333333']
        ]),
        knowledgeVectorSource: { loadBase } as any,
        reduxData: {
          knowledge: {
            bases: [
              { id: 'kb-missing-model', name: 'Missing Model Base', items: [] },
              {
                id: 'kb-load-fails',
                name: 'Load Fails Base',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator()
      const result = await migrator.prepare(migrationCtx as any)

      // An unreadable legacy DB is a per-base skip (mirrors KnowledgeMigrator's failed tombstone),
      // not a fatal failure — re-running once the DB is readable recovers it without re-embedding.
      expect(result.success).toBe(true)
      expect(loadBase).toHaveBeenCalledWith('kb-load-fails')
      expect(
        result.warnings?.some((warning) =>
          warning.includes(
            `Skipped knowledge vector records (${KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL}): count=1`
          )
        )
      ).toBe(true)
      expect(
        result.warnings?.some(
          (warning) =>
            warning.includes('Skipped knowledge vector records (read_error): count=1') &&
            warning.includes('loadBase failed')
        )
      ).toBe(true)
    })
  })

  describe('execute + validate', () => {
    it('rebuilds a file material into the 9-table store with byte-identical reused vectors', async () => {
      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
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
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      const executeResult = await migrator.execute(migrationCtx as any)
      expect(executeResult).toMatchObject({ success: true, processedCount: 1 })

      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)

      // meta identity is stamped for the migrated base.
      expect(store.meta).toHaveLength(1)
      expect(store.meta[0]).toMatchObject({
        base_id: MIGRATED_KNOWLEDGE_BASE_ID
      })

      // material: stable identity + provenance from the migrated item data.
      expect(store.material).toHaveLength(1)
      expect(store.material[0]).toMatchObject({
        material_id: MIGRATED_FILE_ITEM_ID,
        relative_path: `${MIGRATED_FILE_ITEM_ID}.md`
      })

      // content: the unit offsets slice back to the body.
      expect(store.content).toHaveLength(1)
      expect(store.content[0]).toMatchObject({ text: 'file chunk' })
      const unit = store.searchUnit[0]
      expect(unit).toMatchObject({ unit_index: 0, char_start: 0, char_end: 'file chunk'.length })
      expect(String(store.content[0].text).slice(Number(unit.char_start), Number(unit.char_end))).toBe('file chunk')

      // search_text body references the embedding by hash.
      const expectedHash = hashEmbeddingText('file chunk')
      expect(store.searchText).toHaveLength(1)
      expect(store.searchText[0]).toMatchObject({
        target_type: 'search_unit',
        kind: 'body',
        text: 'file chunk',
        embedding_text_hash: expectedHash
      })

      // embedding: vector reused verbatim — byte-identical to encodeVectorBlob (no re-embed).
      expect(store.embedding).toHaveLength(1)
      expect(store.embedding[0].embedding_text_hash).toBe(expectedHash)
      expect(Number(store.embedding[0].bytes)).toBe(2 * 4)
      expect(Buffer.from(store.embedding[0].vector_blob as unknown as Uint8Array)).toEqual(
        Buffer.from(encodeVectorBlob([1, 2]))
      )

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(true)
      expect(validateResult.errors).toStrictEqual([])
      expect(validateResult.stats).toMatchObject({ sourceCount: 1, targetCount: 1, skippedCount: 0 })

      // The legacy embedjs DB is left in place; only the new uuid-pathed store is written.
      expect(fs.existsSync(`${runtimeVectorStorePath(MIGRATED_KNOWLEDGE_BASE_ID)}.vectorstore.tmp`)).toBe(false)
      expect(fs.existsSync(runtimeVectorStorePath(MIGRATED_KNOWLEDGE_BASE_ID))).toBe(true)
      expect(fs.existsSync(dbPath)).toBe(true)
      expect(fs.existsSync(`${dbPath}.embedjs.bak`)).toBe(false)
    })

    it('re-attributes a v1-indexed directory vectors to file children instead of dropping the folder', async () => {
      // Regression for the empty-index bug: v1 booked the folder files under the directory
      // item loader ids, so on migration those vectors were skipped as a non-indexable
      // container and the v2 store came up empty. KnowledgeMigrator now synthesizes a file
      // child per embedded file and publishes a loader -> child remap; the vector migrator
      // must route the folder chunks onto those children so the folder stays searchable, no
      // re-embedding, with same-named files staying collision-free.
      const MIGRATED_DIR_CHILD_A_ID = '0198f3f2-7d20-7abc-8def-123456789abc'
      const MIGRATED_DIR_CHILD_B_ID = '0198f3f2-7d21-7abc-8def-123456789abc'

      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
      await createLegacyVectorDb(dbPath, [
        {
          id: 'legacy-dir-a-0',
          pageContent: 'api readme',
          uniqueLoaderId: 'loader-dir-a',
          source: '/docs/api/README.md',
          vector: [1, 2]
        },
        {
          id: 'legacy-dir-b-0',
          pageContent: 'web readme',
          uniqueLoaderId: 'loader-dir-b',
          source: '/docs/web/README.md',
          vector: [3, 4]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_DIRECTORY_ITEM_ID, {
            type: 'directory',
            data: { source: '/docs', path: '/docs' }
          }),
          createMigratedItem(MIGRATED_DIR_CHILD_A_ID, {
            data: { source: '/docs/api/README.md', relativePath: MIGRATED_DIR_CHILD_A_ID }
          }),
          createMigratedItem(MIGRATED_DIR_CHILD_B_ID, {
            data: { source: '/docs/web/README.md', relativePath: MIGRATED_DIR_CHILD_B_ID }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [
                  {
                    id: 'item-directory',
                    type: 'directory',
                    uniqueId: 'DirectoryLoader_ignore',
                    uniqueIds: ['loader-dir-a', 'loader-dir-b']
                  }
                ]
              }
            ]
          }
        }
      })

      // KnowledgeMigrator publishes this after expanding the directory into children, scoped
      // by migrated base id. Key kept in sync with KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY.
      migrationCtx.sharedData.set(
        'knowledgeDirectoryChildLoaderRemap',
        new Map([
          [
            MIGRATED_KNOWLEDGE_BASE_ID,
            new Map([
              ['loader-dir-a', MIGRATED_DIR_CHILD_A_ID],
              ['loader-dir-b', MIGRATED_DIR_CHILD_B_ID]
            ])
          ]
        ])
      )

      const migrator = new KnowledgeVectorMigrator() as any
      const prepareResult = await migrator.prepare(migrationCtx as any)
      expect(prepareResult.success).toBe(true)

      // The folder vectors land on the file children, not skipped as a container.
      expect(materialItemIds(migrator).sort()).toEqual([MIGRATED_DIR_CHILD_A_ID, MIGRATED_DIR_CHILD_B_ID].sort())
      expect(migrator.skippedCount).toBe(0)
      expect(prepareResult.warnings?.some((warning) => warning.includes('non_indexable_container'))).toBeFalsy()

      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // The runtime store is no longer empty: one material per child, same-named README.md
      // files collision-free (relative_path = each child own id), vectors reused verbatim.
      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.material.map((m) => m.material_id).sort()).toEqual(
        [MIGRATED_DIR_CHILD_A_ID, MIGRATED_DIR_CHILD_B_ID].sort()
      )
      expect(store.material.map((m) => m.relative_path).sort()).toEqual(
        [MIGRATED_DIR_CHILD_A_ID, MIGRATED_DIR_CHILD_B_ID].sort()
      )
      expect(store.embedding).toHaveLength(2)
      expect(store.content.map((c) => String(c.text)).sort()).toEqual(['api readme', 'web readme'])
    })

    it('scopes the directory-child loader remap per base so a shared loader id never clobbers across bases', async () => {
      // v1 LocalPathLoader ids are content/path hashes with no base component, so the SAME loader id
      // can legitimately appear under two different bases. The remap must be keyed by migrated base
      // id: a flat/all-bases map would let base B's entry overwrite base A's, routing A's vectors to
      // B's child (or skipping them as a container). This drives both bases end-to-end and asserts
      // each base's vector lands only on its own child, in its own store.
      const SHARED_LOADER_ID = 'loader-dir-shared'
      const MIGRATED_BASE_B_ID = '22222222-2222-4222-8222-222222222222'
      const MIGRATED_DIRECTORY_B_ITEM_ID = '0198f3f2-7e30-7abc-8def-123456789abc'
      const DIR_A_CHILD_ID = '0198f3f2-7e10-7abc-8def-123456789abc'
      const DIR_B_CHILD_ID = '0198f3f2-7e20-7abc-8def-123456789abc'

      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-a-0',
          pageContent: 'base a shared',
          uniqueLoaderId: SHARED_LOADER_ID,
          source: '/docs-a/shared.md',
          vector: [1, 2]
        }
      ])
      await createLegacyVectorDb(path.join(knowledgeBaseDir, 'kb-2'), [
        {
          id: 'legacy-b-0',
          pageContent: 'base b shared',
          uniqueLoaderId: SHARED_LOADER_ID,
          source: '/docs-b/shared.md',
          vector: [3, 4]
        }
      ])

      const migrationCtx = createMigrationCtx({
        knowledgeBaseIdRemap: new Map([
          [LEGACY_KNOWLEDGE_BASE_ID, MIGRATED_KNOWLEDGE_BASE_ID],
          ['kb-2', MIGRATED_BASE_B_ID]
        ]),
        knowledgeItemIdRemap: new Map([
          ['item-dir-a', MIGRATED_DIRECTORY_ITEM_ID],
          ['item-dir-b', MIGRATED_DIRECTORY_B_ITEM_ID]
        ]),
        migratedBases: [createMigratedBase(), createMigratedBase({ id: MIGRATED_BASE_B_ID })],
        migratedItems: [
          createMigratedItem(MIGRATED_DIRECTORY_ITEM_ID, {
            type: 'directory',
            data: { source: '/docs-a', path: '/docs-a' }
          }),
          createMigratedItem(DIR_A_CHILD_ID, {
            data: { source: '/docs-a/shared.md', relativePath: DIR_A_CHILD_ID }
          }),
          createMigratedItem(MIGRATED_DIRECTORY_B_ITEM_ID, {
            baseId: MIGRATED_BASE_B_ID,
            type: 'directory',
            data: { source: '/docs-b', path: '/docs-b' }
          }),
          createMigratedItem(DIR_B_CHILD_ID, {
            baseId: MIGRATED_BASE_B_ID,
            data: { source: '/docs-b/shared.md', relativePath: DIR_B_CHILD_ID }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base A',
                items: [
                  { id: 'item-dir-a', type: 'directory', uniqueId: 'DirectoryLoader_a', uniqueIds: [SHARED_LOADER_ID] }
                ]
              },
              {
                id: 'kb-2',
                name: 'Base B',
                items: [
                  { id: 'item-dir-b', type: 'directory', uniqueId: 'DirectoryLoader_b', uniqueIds: [SHARED_LOADER_ID] }
                ]
              }
            ]
          }
        }
      })

      // The same loader id is mapped to a DIFFERENT child under each migrated base.
      migrationCtx.sharedData.set(
        'knowledgeDirectoryChildLoaderRemap',
        new Map([
          [MIGRATED_KNOWLEDGE_BASE_ID, new Map([[SHARED_LOADER_ID, DIR_A_CHILD_ID]])],
          [MIGRATED_BASE_B_ID, new Map([[SHARED_LOADER_ID, DIR_B_CHILD_ID]])]
        ])
      )

      const migrator = new KnowledgeVectorMigrator() as any
      const prepareResult = await migrator.prepare(migrationCtx as any)
      expect(prepareResult.success).toBe(true)
      expect(migrator.skippedCount).toBe(0)
      expect(prepareResult.warnings?.some((warning) => warning.includes('non_indexable_container'))).toBeFalsy()

      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // Base A's legacy vector landed only on A's child, in A's store; base B's only on B's child.
      const storeA = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(storeA.material.map((m) => m.material_id)).toEqual([DIR_A_CHILD_ID])
      expect(storeA.content.map((c) => String(c.text))).toEqual(['base a shared'])

      const storeB = await readStore(MIGRATED_BASE_B_ID)
      expect(storeB.material.map((m) => m.material_id)).toEqual([DIR_B_CHILD_ID])
      expect(storeB.content.map((c) => String(c.text))).toEqual(['base b shared'])
    })

    it('concatenates an item’s chunks in order with separator-aware offsets', async () => {
      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
      await createLegacyVectorDb(dbPath, [
        {
          id: 'legacy-file-0',
          pageContent: 'first chunk',
          uniqueLoaderId: 'loader-file-a',
          source: '/tmp/file-1.md',
          vector: [1, 2]
        },
        {
          id: 'legacy-file-1',
          pageContent: 'second chunk',
          uniqueLoaderId: 'loader-file-b',
          source: '/tmp/file-1.md',
          vector: [3, 4]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueIds: ['loader-file-a', 'loader-file-b'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      const text = String(store.content[0].text)
      expect(text).toBe('first chunk\n\nsecond chunk')
      expect(store.searchUnit.map((u) => Number(u.unit_index))).toEqual([0, 1])
      for (const unit of store.searchUnit) {
        const body = text.slice(Number(unit.char_start), Number(unit.char_end))
        expect(['first chunk', 'second chunk']).toContain(body)
      }
      expect(store.embedding).toHaveLength(2)
    })

    it('writes an empty but valid store when a base has no migratable materials', async () => {
      const migrationCtx = createEmptyRemapMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        knowledgeVectorSource: {
          loadBase: vi.fn().mockResolvedValue({
            status: 'ok',
            dbPath: path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID),
            rows: []
          })
        } as unknown as KnowledgeVectorSourceReader,
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.material).toEqual([])
      expect(store.searchUnit).toEqual([])
      expect(store.embedding).toEqual([])
      // The identity row is still stamped so the runtime opens it without re-bootstrapping.
      expect(store.meta).toHaveLength(1)

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(true)
    })

    it('reports rebuild progress once per migrated material', async () => {
      const migrator = new KnowledgeVectorMigrator() as any
      const dbPath = path.join(knowledgeBaseDir, 'progress', '.cherry', 'index.sqlite')
      const reportedProgress: number[] = []

      const material = (itemId: string, text: string, vector: number[]) => ({
        itemId,
        input: {
          material: { relativePath: itemId },
          content: { text },
          units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: text.length }],
          embeddings: [{ embeddingTextHash: hashEmbeddingText(text), vector }]
        }
      })

      migrator.preparedBasePlans = [
        {
          baseId: 'progress',
          materialDirPath: path.join(knowledgeBaseDir, 'progress', 'raw'),
          targetDbPath: dbPath,
          dimensions: 2,
          embeddingModelId: 'ollama::nomic-embed-text',
          chunkerConfigHash: 'hash',
          materials: [
            material('item-0', 'chunk zero', [0, 1]),
            material('item-1', 'chunk one', [1, 2]),
            material('item-2', 'chunk two', [2, 3]),
            material('item-3', 'chunk three', [3, 4])
          ],
          materialSnapshots: [],
          expectedUnitCount: 4,
          expectedEmbeddingCount: 4,
          sourceRowCount: 4
        }
      ]

      migrator.setProgressCallback((progress: number) => {
        reportedProgress.push(progress)
      })

      await expect(migrator.execute()).resolves.toMatchObject({ success: true, processedCount: 4 })
      expect(reportedProgress).toEqual([25, 50, 75, 100])
      expect(fs.existsSync(dbPath)).toBe(true)
      expect(fs.existsSync(`${dbPath}.vectorstore.tmp`)).toBe(false)
    })

    it('removes the target store with EBUSY-survivable retry options before renaming', async () => {
      const migrator = new KnowledgeVectorMigrator() as any
      const dbPath = path.join(knowledgeBaseDir, 'ebusy', '.cherry', 'index.sqlite')

      migrator.preparedBasePlans = [
        {
          baseId: 'ebusy',
          materialDirPath: path.join(knowledgeBaseDir, 'ebusy', 'raw'),
          targetDbPath: dbPath,
          dimensions: 2,
          embeddingModelId: 'ollama::nomic-embed-text',
          chunkerConfigHash: 'hash',
          materials: [
            {
              itemId: 'item-0',
              input: {
                material: { relativePath: 'item-0' },
                content: { text: 'doc' },
                units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: 3 }],
                embeddings: [{ embeddingTextHash: hashEmbeddingText('doc'), vector: [1, 2] }]
              }
            }
          ],
          materialSnapshots: [],
          expectedUnitCount: 1,
          expectedEmbeddingCount: 1,
          sourceRowCount: 1
        }
      ]

      const rmSpy = vi.spyOn(fs.promises, 'rm')
      await expect(migrator.execute()).resolves.toMatchObject({ success: true })

      const targetRmCall = rmSpy.mock.calls.find(([target]) => target === dbPath)
      expect(targetRmCall).toBeDefined()
      expect(targetRmCall?.[1]).toMatchObject({
        recursive: true,
        force: true,
        maxRetries: expect.any(Number),
        retryDelay: expect.any(Number)
      })
    })

    it('fails the migration when a material rebuild fails, without counting it', async () => {
      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
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
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)

      vi.spyOn(KnowledgeIndexStore.prototype, 'rebuildMaterial').mockRejectedValueOnce(new Error('rebuild failed'))

      const executeResult = await migrator.execute(migrationCtx as any)
      expect(executeResult.success).toBe(false)
      expect(executeResult.processedCount).toBe(0)
      expect(executeResult.error).toContain(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(executeResult.error).toContain('rebuild failed')
      expect(migrator.skippedCount).toBe(0)
      expect(fs.existsSync(`${runtimeVectorStorePath(MIGRATED_KNOWLEDGE_BASE_ID)}.vectorstore.tmp`)).toBe(false)
      expect(fs.existsSync(dbPath)).toBe(true)
    })

    it('surfaces the real execution error when temp-store cleanup itself throws', async () => {
      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
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
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)

      // The rebuild fails (the real error), sending execute into its catch block...
      vi.spyOn(KnowledgeIndexStore.prototype, 'rebuildMaterial').mockRejectedValueOnce(new Error('rebuild failed'))
      // ...where the temp-store cleanup itself also throws (e.g. a Windows-locked index.sqlite).
      // The first call (pre-rebuild temp clear) must still succeed so the rebuild is reached.
      migrator.removeIndexStoreFiles = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('EPERM: index store locked'))

      // The cleanup rejection must not escape past the structured return (the W2 fix): execute
      // resolves to a failure carrying the *real* rebuild error, not the masking cleanup error.
      const executeResult = await migrator.execute(migrationCtx as any)
      expect(executeResult.success).toBe(false)
      expect(executeResult.error).toContain('rebuild failed')
      expect(executeResult.error).not.toContain('EPERM')
    })

    it('validate fails when a stored unit has no backing embedding', async () => {
      const dbPath = path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID)
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
        migratedBases: [createMigratedBase()],
        migratedItems: [createMigratedItem(MIGRATED_FILE_ITEM_ID)],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-file', type: 'file', uniqueId: 'loader-file' }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // Corrupt the store: drop the embedding the unit depends on.
      const client = createClient({ url: pathToFileURL(runtimeVectorStorePath(MIGRATED_KNOWLEDGE_BASE_ID)).toString() })
      await client.execute('DELETE FROM embedding')
      client.close()

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(false)
      expect(validateResult.errors).toContainEqual(
        expect.objectContaining({ key: `knowledge_vector_uncovered_units_${MIGRATED_KNOWLEDGE_BASE_ID}` })
      )
      expect(validateResult.errors).toContainEqual(
        expect.objectContaining({ key: `knowledge_vector_embedding_count_mismatch_${MIGRATED_KNOWLEDGE_BASE_ID}` })
      )
    })

    it('materializes a migrated url as a frontmatter-stamped snapshot and pins the item row', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-url-0',
          pageContent: '# LLM Guide',
          uniqueLoaderId: 'loader-url-a',
          source: 'https://example.com/guide',
          vector: [1, 2]
        },
        {
          id: 'legacy-url-1',
          pageContent: 'second chunk',
          uniqueLoaderId: 'loader-url-b',
          source: 'https://example.com/guide',
          vector: [3, 4]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/guide', url: 'https://example.com/guide' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueIds: ['loader-url-a', 'loader-url-b'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // The snapshot lands in the base under a heading-derived name, stamped with
      // OKF frontmatter that strips back off to exactly the stored content text —
      // the hash round-trip that lets reindex reuse the migrated vectors.
      const snapshotPath = runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'LLM Guide.md')
      expect(fs.existsSync(snapshotPath)).toBe(true)
      const fileText = fs.readFileSync(snapshotPath, 'utf-8')
      expect(fileText).toMatch(/^---\ntype: "URL"\ntitle: "LLM Guide"\nresource: "https:\/\/example\.com\/guide"\n/)
      expect(fileText).toMatch(/timestamp: "\d{4}-\d{2}-\d{2}T[^"]+"\n/)

      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.content[0].text).toBe('# LLM Guide\n\nsecond chunk')
      expect(stripOkfFrontmatter(fileText)).toBe(store.content[0].text)

      // The material row uses the real snapshot path, not the virtual item id.
      expect(store.material[0]).toMatchObject({
        material_id: MIGRATED_SITEMAP_URL_ITEM_ID,
        relative_path: 'LLM Guide.md'
      })

      // The item row is pinned so the first reindex reads the snapshot offline.
      expect(migrationCtx.db.updateCalls).toHaveLength(1)
      expect(migrationCtx.db.updateCalls[0].values).toEqual({
        data: {
          source: 'https://example.com/guide',
          url: 'https://example.com/guide',
          relativePath: 'LLM Guide.md'
        }
      })

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(true)
      expect(validateResult.errors).toStrictEqual([])
    })

    it('validate fails when a materialized url snapshot file is missing from the material root', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-url-0',
          pageContent: '# LLM Guide',
          uniqueLoaderId: 'loader-url-a',
          source: 'https://example.com/guide',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/guide', url: 'https://example.com/guide' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueIds: ['loader-url-a'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // Remove the snapshot from the real runtime material root. validate must read the
      // same `raw/` path the runtime does, so it should surface this as a missing snapshot —
      // if it checked any other path the deletion would go unnoticed.
      const snapshotPath = runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'LLM Guide.md')
      expect(fs.existsSync(snapshotPath)).toBe(true)
      fs.rmSync(snapshotPath)

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(false)
      expect(validateResult.errors).toContainEqual(
        expect.objectContaining({ key: `knowledge_vector_material_snapshots_${MIGRATED_KNOWLEDGE_BASE_ID}` })
      )
    })

    it('dedupes the snapshot name around paths other items already occupy', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-url-0',
          pageContent: '# LLM Guide',
          uniqueLoaderId: 'loader-url-a',
          source: 'https://example.com/guide',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_FILE_ITEM_ID, {
            data: { source: '/tmp/LLM Guide.md', relativePath: 'LLM Guide.md' }
          }),
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/guide', url: 'https://example.com/guide' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueIds: ['loader-url-a'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      expect(fs.existsSync(runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'LLM Guide_1.md'))).toBe(true)
      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.material[0]).toMatchObject({ relative_path: 'LLM Guide_1.md' })
    })

    it('dedupes a snapshot around an unprocessed file’s prospective markdown artifact', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-url-0',
          pageContent: '# guide',
          uniqueLoaderId: 'loader-url-a',
          source: 'https://example.com/guide',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        // A processor is configured, so a document file will later emit a `.md` artifact.
        migratedBases: [createMigratedBase({ fileProcessorId: 'doc2x' })],
        migratedItems: [
          // An unprocessed file (relativePath set, no indexedRelativePath): its eventual
          // reindex will produce `guide.md`, so that slot must be reserved now.
          createMigratedItem(MIGRATED_FILE_ITEM_ID, {
            data: { source: '/tmp/guide.pdf', relativePath: 'guide.pdf' }
          }),
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/guide', url: 'https://example.com/guide' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueIds: ['loader-url-a'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // The url snapshot would naturally be `guide.md`, but that is the file's prospective
      // processed artifact, so it dedupes to `guide_1.md` (N1: the migrator passes
      // fileProcessorId, reserving the same prospective slot the runtime add path does — so a
      // later reindex `.md` and this snapshot can never overwrite each other).
      expect(fs.existsSync(runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'guide_1.md'))).toBe(true)
      expect(fs.existsSync(runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'guide.md'))).toBe(false)
      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.material[0]).toMatchObject({ relative_path: 'guide_1.md' })
    })

    it('reuses an already-pinned relativePath on re-run instead of renaming', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-url-0',
          pageContent: '# LLM Guide',
          uniqueLoaderId: 'loader-url-a',
          source: 'https://example.com/guide',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'url',
            data: { source: 'https://example.com/guide', url: 'https://example.com/guide', relativePath: 'Pinned.md' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'sitemap', uniqueIds: ['loader-url-a'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      expect(fs.existsSync(runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'Pinned.md'))).toBe(true)
      expect(fs.existsSync(runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'Pinned_1.md'))).toBe(false)
      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.material[0]).toMatchObject({ relative_path: 'Pinned.md' })
      expect(migrationCtx.db.updateCalls[0].values).toEqual({
        data: {
          source: 'https://example.com/guide',
          url: 'https://example.com/guide',
          relativePath: 'Pinned.md'
        }
      })
    })

    it('materializes a migrated note as an OKF-frontmatter snapshot and pins the item row', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-note-0',
          pageContent: '# Meeting notes',
          uniqueLoaderId: 'loader-note-a',
          source: 'note',
          vector: [1, 2]
        },
        {
          id: 'legacy-note-1',
          pageContent: 'second chunk',
          uniqueLoaderId: 'loader-note-b',
          source: 'note',
          vector: [3, 4]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'note',
            data: { source: 'Meeting notes', content: 'original note body' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'note', uniqueIds: ['loader-note-a', 'loader-note-b'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)
      expect((await migrator.execute(migrationCtx as any)).success).toBe(true)

      // The snapshot lands under a source-title-derived name, stamped with OKF
      // frontmatter that strips back off to exactly the stored content text — the
      // hash round-trip that lets reindex reuse the migrated vectors.
      const snapshotPath = runtimeMaterialPath(MIGRATED_KNOWLEDGE_BASE_ID, 'Meeting notes.md')
      expect(fs.existsSync(snapshotPath)).toBe(true)
      const fileText = fs.readFileSync(snapshotPath, 'utf-8')
      expect(fileText).toMatch(/^---\ntype: "Note"\ntitle: "Meeting notes"\n/)

      const store = await readStore(MIGRATED_KNOWLEDGE_BASE_ID)
      expect(store.content[0].text).toBe('# Meeting notes\n\nsecond chunk')
      expect(stripOkfFrontmatter(fileText)).toBe(store.content[0].text)

      // The material row uses the real snapshot path, not the virtual item id.
      expect(store.material[0]).toMatchObject({
        material_id: MIGRATED_SITEMAP_URL_ITEM_ID,
        relative_path: 'Meeting notes.md'
      })

      // The item row is pinned so the first reindex reads the snapshot offline.
      expect(migrationCtx.db.updateCalls).toHaveLength(1)
      expect(migrationCtx.db.updateCalls[0].values).toEqual({
        data: {
          source: 'Meeting notes',
          content: 'original note body',
          relativePath: 'Meeting notes.md'
        }
      })

      const validateResult = await migrator.validate(migrationCtx as any)
      expect(validateResult.success).toBe(true)
      expect(validateResult.errors).toStrictEqual([])
    })

    it('rejects a reused snapshot relativePath that escapes the material root', async () => {
      await createLegacyVectorDb(path.join(knowledgeBaseDir, LEGACY_KNOWLEDGE_BASE_ID), [
        {
          id: 'legacy-note-0',
          pageContent: '# Meeting notes',
          uniqueLoaderId: 'loader-note-a',
          source: 'note',
          vector: [1, 2]
        }
      ])

      const migrationCtx = createMigrationCtx({
        migratedBases: [createMigratedBase()],
        migratedItems: [
          createMigratedItem(MIGRATED_SITEMAP_URL_ITEM_ID, {
            type: 'note',
            // A corrupt persisted relativePath from a prior run: the reused-path branch
            // takes it verbatim, so the write must be guarded before it escapes `raw/`.
            data: { source: 'Meeting notes', content: 'original note body', relativePath: '../escape.md' }
          })
        ],
        reduxData: {
          knowledge: {
            bases: [
              {
                id: LEGACY_KNOWLEDGE_BASE_ID,
                name: 'Base 1',
                items: [{ id: 'item-sitemap', type: 'note', uniqueIds: ['loader-note-a'] }]
              }
            ]
          }
        }
      })

      const migrator = new KnowledgeVectorMigrator() as any
      expect((await migrator.prepare(migrationCtx as any)).success).toBe(true)

      const executeResult = await migrator.execute(migrationCtx as any)
      expect(executeResult.success).toBe(false)
      expect(executeResult.error).toContain('Invalid knowledge relative path')
      // The traversal target was never written outside the material root.
      expect(fs.existsSync(path.join(knowledgeBaseDir, MIGRATED_KNOWLEDGE_BASE_ID, 'escape.md'))).toBe(false)
    })
  })
})
