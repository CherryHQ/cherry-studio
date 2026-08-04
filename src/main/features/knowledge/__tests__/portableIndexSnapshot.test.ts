import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { BaseService } from '@main/core/lifecycle'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashEmbeddingText } from '../pipeline/vectorstore/indexStore/hashing'
import { KnowledgeVectorStoreService } from '../pipeline/vectorstore/KnowledgeVectorStoreService'
import { capturePortableKnowledgeIndex } from '../portableIndexSnapshot'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-7222-8222-222222222222'
const EXTRA_ITEM_ID = '33333333-3333-7333-8333-333333333333'
const DOCUMENT_TEXT = 'portable knowledge index'
const defaultApplicationGet = application.get.bind(application)

describe('portable Knowledge index snapshot', () => {
  const dbh = setupTestDatabase()
  let tempDir = ''
  let knowledgeRoot = ''
  let service: KnowledgeVectorStoreService
  let getSpy: { mockRestore(): void }

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'cs-portable-knowledge-index-'))
    knowledgeRoot = path.join(tempDir, 'KnowledgeBase')
    BaseService.resetInstances()
    service = new KnowledgeVectorStoreService()

    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const base = key === 'feature.knowledgebase.data' ? knowledgeRoot : path.join(tempDir, key)
      return filename ? path.join(base, filename) : base
    })
    getSpy = vi.spyOn(application, 'get').mockImplementation(((name: Parameters<typeof application.get>[0]) => {
      if (name === 'KnowledgeVectorStoreService') return service
      return defaultApplicationGet(name)
    }) as never)

    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'Portable',
        status: 'completed',
        chunkSize: 512,
        chunkOverlap: 32
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: ITEM_ID,
        baseId: BASE_ID,
        type: 'file',
        data: { source: '/source/doc.md', relativePath: 'doc.md' },
        status: 'completed'
      })
      .run()
  })

  afterEach(async () => {
    getSpy.mockRestore()
    await service._doStop()
    vi.mocked(application.getPath).mockReset()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function base(): KnowledgeBase {
    return {
      id: BASE_ID,
      name: 'Portable',
      groupId: null,
      dimensions: null,
      embeddingModelId: null,
      status: 'completed',
      error: null,
      chunkSize: 512,
      chunkOverlap: 32,
      chunkStrategy: 'structured',
      chunkSeparator: '\\n\\n',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z'
    }
  }

  async function indexMaterial(materialId: string, relativePath: string, usesEmbeddings = false): Promise<void> {
    const store = service.getIndexStore(base())
    store.rebuildMaterial(materialId, {
      material: { relativePath },
      content: { text: DOCUMENT_TEXT },
      units: [{ unitType: 'chunk', unitIndex: 0, charStart: 0, charEnd: DOCUMENT_TEXT.length }],
      usesEmbeddings,
      embeddings: usesEmbeddings ? [{ embeddingTextHash: hashEmbeddingText(DOCUMENT_TEXT), vector: [1, 0] }] : []
    })
  }

  async function detachedMainDb(): Promise<string> {
    const destination = path.join(tempDir, `main-${randomUUID()}.sqlite`)
    await dbh.sqlite.backup(destination)
    return destination
  }

  it('backs up the live WAL database and prunes material newer than the main DB cut', async () => {
    await indexMaterial(ITEM_ID, 'doc.md')
    await indexMaterial(EXTRA_ITEM_ID, 'newer.md')

    const destination = path.join(tempDir, 'staged', 'index.sqlite')
    const result = await capturePortableKnowledgeIndex({
      baseId: BASE_ID,
      detachedDbPath: await detachedMainDb(),
      destination
    })

    expect(result).toEqual({ status: 'ready', stagedPath: destination })
    const snapshot = new Database(destination, { readonly: true, fileMustExist: true })
    try {
      expect(snapshot.pragma('quick_check', { simple: true })).toBe('ok')
      expect(snapshot.prepare('SELECT material_id, relative_path FROM material').all()).toEqual([
        { material_id: ITEM_ID, relative_path: 'doc.md' }
      ])
      expect(snapshot.prepare('SELECT COUNT(*) AS count FROM search_unit').get()).toEqual({ count: 1 })
    } finally {
      snapshot.close()
    }
  })

  it('falls back to rebuild when the right path belongs to the wrong material id', async () => {
    await indexMaterial(EXTRA_ITEM_ID, 'doc.md')
    const destination = path.join(tempDir, 'wrong-owner', 'index.sqlite')

    await expect(
      capturePortableKnowledgeIndex({
        baseId: BASE_ID,
        detachedDbPath: await detachedMainDb(),
        destination
      })
    ).resolves.toEqual({ status: 'rebuild', reason: 'material-mismatch' })
    expect(existsSync(destination)).toBe(false)
  })

  it('falls back to rebuild when a vector base has a search unit without its embedding', async () => {
    await indexMaterial(ITEM_ID, 'doc.md', true)
    const detached = await detachedMainDb()
    const detachedDb = new Database(detached)
    try {
      detachedDb.pragma('foreign_keys = OFF')
      detachedDb
        .prepare('UPDATE knowledge_base SET embedding_model_id = ?, dimensions = ? WHERE id = ?')
        .run('detached-model', 2, BASE_ID)
    } finally {
      detachedDb.close()
    }

    const liveIndexPath = path.join(knowledgeRoot, BASE_ID, '.cherry', 'index.sqlite')
    const liveIndex = new Database(liveIndexPath)
    try {
      liveIndex.prepare('DELETE FROM embedding').run()
    } finally {
      liveIndex.close()
    }

    const destination = path.join(tempDir, 'missing-vector', 'index.sqlite')
    await expect(
      capturePortableKnowledgeIndex({
        baseId: BASE_ID,
        detachedDbPath: detached,
        destination
      })
    ).resolves.toEqual({ status: 'rebuild', reason: 'embedding-missing' })
    expect(existsSync(destination)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('does not follow an index symlink outside the managed base', async () => {
    await indexMaterial(ITEM_ID, 'doc.md')
    await service._doStop()

    const liveIndexPath = path.join(knowledgeRoot, BASE_ID, '.cherry', 'index.sqlite')
    const externalIndexPath = path.join(tempDir, 'external-index.sqlite')
    renameSync(liveIndexPath, externalIndexPath)
    symlinkSync(externalIndexPath, liveIndexPath)

    const destination = path.join(tempDir, 'symlink', 'index.sqlite')
    await expect(
      capturePortableKnowledgeIndex({
        baseId: BASE_ID,
        detachedDbPath: await detachedMainDb(),
        destination
      })
    ).resolves.toEqual({ status: 'rebuild', reason: 'snapshot-failed' })
    expect(existsSync(destination)).toBe(false)
  })
})
