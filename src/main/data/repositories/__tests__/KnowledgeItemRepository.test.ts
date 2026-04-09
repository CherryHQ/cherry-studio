import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { DbType } from '@data/db/types'
import { createClient } from '@libsql/client'
import type { KnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: getDbMock
    }))
  }
}))

const { KnowledgeItemRepository } = await import('../KnowledgeItemRepository')

describe('KnowledgeItemRepository', () => {
  let db: DbType
  let closeClient: (() => void) | undefined
  let repository: InstanceType<typeof KnowledgeItemRepository>

  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' })
    closeClient = () => client.close()
    db = drizzle({
      client,
      casing: 'snake_case'
    })
    getDbMock.mockReturnValue(db)
    repository = new KnowledgeItemRepository()

    await db.run(sql`PRAGMA foreign_keys = ON`)
    await db.run(
      sql.raw(`
        CREATE TABLE knowledge_base (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          dimensions INTEGER NOT NULL,
          embedding_model_id TEXT NOT NULL,
          rerank_model_id TEXT,
          file_processor_id TEXT,
          chunk_size INTEGER,
          chunk_overlap INTEGER,
          threshold REAL,
          document_count INTEGER,
          search_mode TEXT,
          hybrid_alpha REAL,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_base_search_mode_check CHECK (search_mode IN ('default', 'bm25', 'hybrid') OR search_mode IS NULL)
        )
      `)
    )
    await db.run(
      sql.raw(`
        CREATE TABLE knowledge_item (
          id TEXT PRIMARY KEY NOT NULL,
          base_id TEXT NOT NULL,
          group_id TEXT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          CONSTRAINT knowledge_item_type_check CHECK (type IN ('file', 'url', 'note', 'sitemap', 'directory')),
          CONSTRAINT knowledge_item_status_check CHECK (status IN ('idle', 'pending', 'file_processing', 'read', 'embed', 'completed', 'failed')),
          FOREIGN KEY (base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
          FOREIGN KEY (base_id, group_id) REFERENCES knowledge_item(base_id, id) ON DELETE CASCADE,
          CONSTRAINT knowledge_item_baseId_id_unique UNIQUE (base_id, id)
        )
      `)
    )

    await db.insert(knowledgeBaseTable).values({
      id: 'kb-1',
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'openai::text-embedding-3-large'
    })

    await db.insert(knowledgeItemTable).values([
      {
        id: 'dir-a',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: { name: 'a', path: '/a' },
        status: 'idle',
        error: null,
        createdAt: 100
      },
      {
        id: 'dir-b',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: { name: 'b', path: '/b' },
        status: 'idle',
        error: null,
        createdAt: 90
      },
      {
        id: 'note-group-a',
        baseId: 'kb-1',
        groupId: 'dir-a',
        type: 'note',
        data: { content: 'group note' },
        status: 'idle',
        error: null,
        createdAt: 80
      },
      {
        id: 'file-group-none',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: {
          file: {
            id: 'file-1',
            name: 'file.txt',
            origin_name: 'file.txt',
            path: '/file.txt',
            size: 10,
            ext: '.txt',
            type: 'text',
            created_at: '2024-01-01T00:00:00.000Z',
            count: 1
          }
        },
        status: 'idle',
        error: null,
        createdAt: 70
      },
      {
        id: 'note-plain',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { content: 'plain note' },
        status: 'idle',
        error: null,
        createdAt: 60
      }
    ])
  })

  afterEach(() => {
    closeClient?.()
    closeClient = undefined
  })

  it('lists rows with pagination and optional type/group filters', async () => {
    const query: KnowledgeItemsQuery = {
      page: 1,
      limit: 20,
      type: 'directory',
      groupId: undefined
    }

    const result = await repository.list('kb-1', query)

    expect(result.total).toBe(2)
    expect(result.rows.map((row) => row.id)).toEqual(['dir-a', 'dir-b'])
  })

  it('returns existing group owner ids in the same base', async () => {
    const existingGroupIds = await repository.getExistingGroupIdsInBase('kb-1', ['dir-a', 'missing-owner'])

    expect(existingGroupIds).toEqual(new Set(['dir-a']))
  })

  it('creates one row with the resolved grouping data supplied by the service layer', async () => {
    const row = await repository.create({
      baseId: 'kb-1',
      groupId: 'dir-a',
      type: 'note',
      data: { content: 'child note' },
      status: 'idle',
      error: null
    })

    expect(row.type).toBe('note')
    expect(row.groupId).toBe('dir-a')
    expect(row.data).toEqual({ content: 'child note' })
  })

  it('returns rows by ids in the original input order', async () => {
    const rows = await repository.getByIdsInBase('kb-1', ['note-plain', 'dir-a'])

    expect(rows.map((row) => row.id)).toEqual(['note-plain', 'dir-a'])
  })

  it('returns recursive cascade ids below the provided roots', async () => {
    await db.insert(knowledgeItemTable).values({
      id: 'note-grandchild',
      baseId: 'kb-1',
      groupId: 'note-group-a',
      type: 'note',
      data: { content: 'grandchild note' },
      status: 'idle',
      error: null,
      createdAt: 50
    })

    const descendantRows = await repository.getCascadeDescendantIdsInBase('kb-1', ['dir-a'])

    expect(descendantRows).toEqual(['note-group-a', 'note-grandchild'])
  })
})
