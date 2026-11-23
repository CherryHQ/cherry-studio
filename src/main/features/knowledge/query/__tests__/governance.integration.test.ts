import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as randomUUID } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { knowledgeChunkGovernanceService as governance } from '@data/services/KnowledgeChunkGovernanceService'
import { ErrorCode } from '@shared/data/api/errors'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'
import { KnowledgeChunkBatchInputSchema } from '@shared/data/types/knowledgeChunkGovernance'
import { createUniqueModelId } from '@shared/data/types/model'
import { KeyedMutex } from '@shared/utils/async'

import { KnowledgeChunkGovernanceWorkflow } from '../../governance/KnowledgeChunkGovernanceWorkflow'
import { openBetterSqlite3IndexDriver } from '../../pipeline/vectorstore/indexStore/BetterSqlite3Driver'
import { betterSqlite3VectorIndex } from '../../pipeline/vectorstore/indexStore/BetterSqlite3VectorIndex'
import { hashContentText, hashEmbeddingText } from '../../pipeline/vectorstore/indexStore/hashing'
import { KnowledgeIndexStore } from '../../pipeline/vectorstore/indexStore/KnowledgeIndexStore'
import type { KnowledgeIndexSearchMode } from '../../pipeline/vectorstore/indexStore/model'
import { createKnowledgeIndexSchema } from '../../pipeline/vectorstore/indexStore/schema'
import { readKnowledgeGovernanceSearchSnapshot } from '../governance'
import { KnowledgeQueryService } from '../KnowledgeQueryService'

const { getStore, embedMany, rerank } = vi.hoisted(() => ({
  getStore: vi.fn(),
  embedMany: vi.fn(),
  rerank: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: { getIndexStore: getStore },
    AiService: { embedMany, rerank }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const baseId = '11111111-1111-4111-8111-111111111111'
const embeddingModelId = createUniqueModelId('openai', 'embedding')
const rerankModelId = createUniqueModelId('openai', 'rerank')

/** Real Main database, index SQLite/FTS/vector engine and production query/rerank path. No provider calls. */
describe('Knowledge governance retrieval authority', () => {
  const dbh = setupTestDatabase()
  const service = new KnowledgeQueryService()
  const lock = new KeyedMutex()
  const workflow = new KnowledgeChunkGovernanceWorkflow(lock)
  let tempDir: string
  let store: KnowledgeIndexStore

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = mkdtempSync(join(tmpdir(), 'cs-governance-query-'))
    const driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
    createKnowledgeIndexSchema(driver)
    store = new KnowledgeIndexStore(driver, betterSqlite3VectorIndex)
    getStore.mockReturnValue(store)
    embedMany.mockResolvedValue({ embeddings: [[1, 0, 0]] })
    rerank.mockImplementation(async ({ documents }: { documents: string[] }) => ({
      ranking: documents.map((_text, originalIndex) => ({ originalIndex, score: 1 - originalIndex / 100 }))
    }))
    dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values([
        {
          id: embeddingModelId,
          providerId: 'openai',
          modelId: 'embedding',
          presetModelId: 'embedding',
          name: 'Embedding',
          orderKey: 'a0'
        },
        {
          id: rerankModelId,
          providerId: 'openai',
          modelId: 'rerank',
          presetModelId: 'rerank',
          name: 'Rerank',
          orderKey: 'a1'
        }
      ])
      .run()
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: baseId,
        name: 'Governed base',
        orderKey: 'a0',
        status: 'completed',
        chunkSize: 1024,
        chunkOverlap: 0,
        documentCount: 1,
        threshold: 0
      })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (!store.isClosed()) store.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function index(itemId: string, texts: string[], vector = [1, 0, 0]) {
    const content = texts.join('\n')
    let offset = 0
    store.rebuildMaterial(itemId, {
      material: { relativePath: `${itemId}.md` },
      content: { text: content },
      units: texts.map((text, unitIndex) => {
        const unit = { unitType: 'chunk' as const, unitIndex, charStart: offset, charEnd: offset + text.length }
        offset += text.length + 1
        return unit
      }),
      usesEmbeddings: true,
      embeddings: texts.map((text) => ({ embeddingTextHash: hashEmbeddingText(text), vector }))
    })
    return store.listMaterialUnits(itemId)
  }

  function material(texts = ['target original'], vector = [1, 0, 0]) {
    const id = randomUUID()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id,
        baseId,
        type: 'note',
        status: 'completed',
        data: {
          source: 'Original note',
          content: texts.join('\n'),
          relativePath: KnowledgeRelativePathSchema.parse(`${id}.md`)
        }
      })
      .run()
    index(id, texts, vector)
    return id
  }

  function save(
    itemId: string,
    unitIndex = 0,
    state = { excluded: true, labels: ['private'], overrideText: null as string | null }
  ) {
    const unit = store.listMaterialUnits(itemId)[unitIndex]
    return governance.create(
      {
        baseId,
        itemId,
        unitId: unit.unitId,
        sourceContentHash: hashContentText(store.readMaterialContent(itemId)!),
        charStart: unit.charStart,
        charEnd: unit.charEnd,
        originalText: unit.text
      },
      state
    )
  }

  function update(record: ReturnType<typeof save>, state: typeof record.state) {
    return governance.updateState({
      baseId,
      itemId: record.itemId,
      unitId: record.unitId,
      sourceContentHash: record.sourceContentHash,
      expectedRevision: record.revision,
      state
    })
  }

  function enableRerank() {
    dbh.db.update(knowledgeBaseTable).set({ rerankModelId }).where(eq(knowledgeBaseTable.id, baseId)).run()
  }

  async function selection(itemId: string) {
    return (await service.listItemChunks(baseId, itemId)).map((chunk) => ({
      itemId,
      unitId: chunk.id,
      sourceContentHash: chunk.governance!.sourceContentHash,
      expectedRevision: chunk.governance!.revision
    }))
  }

  it('atomically edits explicitly selected exclusions and labels without changing source or other units', async () => {
    const id = material(['target one', 'target two', 'target untouched'])
    const selected = (await selection(id)).slice(0, 2)
    await workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target untouched'])
    await workflow.apply({
      baseId,
      selection: (await selection(id)).slice(0, 2),
      action: { kind: 'label', operation: 'add', label: ' review ' }
    })
    let chunks = await service.listItemChunks(baseId, id)
    expect(chunks.map((chunk) => chunk.governance?.labels)).toEqual([['review'], ['review'], []])
    expect(chunks.map((chunk) => chunk.governance?.status)).toEqual(['excluded', 'excluded', 'active'])
    await workflow.apply({
      baseId,
      selection: (await selection(id)).slice(0, 1),
      action: { kind: 'exclusion', excluded: false }
    })
    await workflow.apply({
      baseId,
      selection: (await selection(id)).slice(0, 1),
      action: { kind: 'label', operation: 'remove', label: 'review' }
    })
    chunks = await service.listItemChunks(baseId, id)
    expect(chunks[0].governance).toMatchObject({ excluded: false, labels: [], status: 'active' })
    expect(chunks[1].governance).toMatchObject({ excluded: true, labels: ['review'] })
    expect(store.readMaterialContent(id)).toBe('target one\ntarget two\ntarget untouched')
    expect(embedMany).not.toHaveBeenCalled()
    expect(rerank).not.toHaveBeenCalled()
  })

  it('rolls back an earlier selected write when a later revision is stale', async () => {
    const id = material(['target one', 'target two'])
    const existing = save(id, 1)
    const selected = await selection(id)
    const revised = update(existing, { ...existing.state, labels: ['newer window'] })
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'label', operation: 'add', label: 'stale edit' } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([revised])
    expect(governance.listHistory(baseId, id, existing.unitId)).toHaveLength(2)
  })

  it('rolls back every record and history when a later batch history insert fails', async () => {
    const id = material(['target one', 'target two'])
    const selected = await selection(id)
    dbh.sqlite.exec(`CREATE TEMP TRIGGER fail_second_history BEFORE INSERT ON knowledge_chunk_governance_history
      WHEN (SELECT count(*) FROM knowledge_chunk_governance_history) > 0
      BEGIN SELECT RAISE(ABORT, 'injected second history failure'); END`)
    try {
      await expect(
        workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
      ).rejects.toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_second_history')
    }
    expect(governance.listByBase(baseId)).toEqual([])
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM knowledge_chunk_governance_history').get()).toEqual({ n: 0 })
  })

  it('serializes competing windows and refuses a stale first-edit revision', async () => {
    const id = material()
    const selected = await selection(id)
    const results = await Promise.allSettled([
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } }),
      workflow.apply({ baseId, selection: selected, action: { kind: 'label', operation: 'add', label: 'competing' } })
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(governance.listByBase(baseId)[0]).toMatchObject({ revision: 1, state: { excluded: true, labels: [] } })
  })

  it.each(['source', 'unit', 'ownership'])(
    'rejects a stale or forged %s selection without partial writes',
    async (change) => {
      const id = material(['target one', 'target two'])
      const other = material(['target other'])
      const selected = await selection(id)
      if (change === 'source') selected[1].sourceContentHash = 'f'.repeat(64)
      if (change === 'unit') selected[1].unitId = 'a'.repeat(64)
      if (change === 'ownership') selected[1].unitId = store.listMaterialUnits(other)[0].unitId
      await expect(
        workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      expect(governance.listByBase(baseId)).toEqual([])
    }
  )

  it('authenticates original source slices instead of trusting a returned chunk body', async () => {
    const id = material()
    const selected = await selection(id)
    const units = store.listMaterialUnits(id)
    vi.spyOn(store, 'listMaterialUnits').mockReturnValueOnce([{ ...units[0], text: 'x'.repeat(units[0].text.length) }])
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([])
  })

  it('shows changed-source review state and refuses edits that would conceal unmatched history', async () => {
    const id = material()
    const saved = save(id)
    index(id, ['target changed'])
    const chunks = await service.listItemChunks(baseId, id)
    expect(chunks[0].governance?.status).toBe('review-needed')
    await expect(
      workflow.apply({ baseId, selection: await selection(id), action: { kind: 'exclusion', excluded: false } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([saved])
  })

  it('rechecks lifecycle state after waiting for the same per-base mutation owner', async () => {
    const id = material()
    const selected = await selection(id)
    let release!: () => void
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = lock.runExclusive(baseId, async () => {
      signalStarted()
      await gate
    })
    await started
    const pending = workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    dbh.db.update(knowledgeItemTable).set({ status: 'deleting' }).where(eq(knowledgeItemTable.id, id)).run()
    release()
    await held
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([])
  })

  it('preserves pending corrections and labels while re-enabling and creates no untouched no-op records', async () => {
    const id = material(['target one', 'target two'])
    const saved = save(id, 0, { excluded: true, labels: ['keep'], overrideText: 'pending correction' })
    await workflow.apply({ baseId, selection: await selection(id), action: { kind: 'exclusion', excluded: false } })
    expect(governance.listByBase(baseId)).toHaveLength(1)
    expect(governance.get(baseId, id, saved.unitId)?.state).toEqual({
      excluded: false,
      labels: ['keep'],
      overrideText: 'pending correction'
    })
    expect((await service.listItemChunks(baseId, id))[0].governance?.status).toBe('pending')
  })

  it.each(['processing', 'deleting'] as const)('rejects %s items before creating any decisions', async (status) => {
    const id = material()
    const selected = await selection(id)
    dbh.db.update(knowledgeItemTable).set({ status }).where(eq(knowledgeItemTable.id, id)).run()
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([])
  })

  it('rejects another base and an unavailable source rather than trusting selected IDs', async () => {
    const id = material()
    const selected = await selection(id)
    const foreignBase = '00000000-0000-4000-8000-000000000777'
    const originalBase = dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, baseId)).get()!
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ ...originalBase, id: foreignBase, name: 'Other base' })
      .run()
    dbh.db.update(knowledgeItemTable).set({ baseId: foreignBase }).where(eq(knowledgeItemTable.id, id)).run()
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    dbh.db.update(knowledgeItemTable).set({ baseId }).where(eq(knowledgeItemTable.id, id)).run()
    vi.spyOn(store, 'readMaterialContent').mockReturnValueOnce(null)
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([])
    expect(governance.listByBase(foreignBase)).toEqual([])
  })

  it('rejects a non-completed base without provider work or governance changes', async () => {
    const id = material()
    const selected = await selection(id)
    dbh.db
      .update(knowledgeBaseTable)
      .set({ status: 'failed', error: 'missing_vector_store' })
      .where(eq(knowledgeBaseTable.id, baseId))
      .run()
    await expect(
      workflow.apply({ baseId, selection: selected, action: { kind: 'exclusion', excluded: true } })
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_OPERATION })
    expect(governance.listByBase(baseId)).toEqual([])
    expect(embedMany).not.toHaveBeenCalled()
  })

  it('bounds and validates selections, rejecting duplicates and any caller-supplied correction', async () => {
    const id = material()
    const selected = await selection(id)
    const input = { baseId, selection: selected, action: { kind: 'exclusion', excluded: true } }
    expect(KnowledgeChunkBatchInputSchema.safeParse({ ...input, selection: [] }).success).toBe(false)
    expect(KnowledgeChunkBatchInputSchema.safeParse({ ...input, selection: [selected[0], selected[0]] }).success).toBe(
      false
    )
    expect(
      KnowledgeChunkBatchInputSchema.safeParse({ ...input, action: { ...input.action, overrideText: 'unapproved' } })
        .success
    ).toBe(false)
    expect(
      KnowledgeChunkBatchInputSchema.safeParse({ ...input, selection: Array.from({ length: 501 }, () => selected[0]) })
        .success
    ).toBe(false)
  })

  it('leaves an untouched base empty of decisions and keeps lexical search provider-free', async () => {
    const id = material()
    expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([id])
    expect(governance.listByBase(baseId)).toEqual([])
    expect(embedMany).not.toHaveBeenCalled()
    expect(rerank).not.toHaveBeenCalled()
  })

  it.each<KnowledgeIndexSearchMode>(['bm25', 'vector', 'hybrid'])(
    '%s excludes before bounded candidates, even beyond the Main candidate cap',
    async (mode) => {
      const denied = material(Array.from({ length: 250 }, () => 'target'))
      const allowed = material(['target allowed'], [0.9, 0.1, 0])
      for (let i = 0; i < 250; i++) save(denied, i)
      const snapshot = readKnowledgeGovernanceSearchSnapshot(baseId, store)
      const hits = store.search({
        queryText: 'target',
        queryEmbedding: [1, 0, 0],
        mode,
        topK: 1,
        exclusions: snapshot.exclusions
      })
      expect(hits.map((hit) => hit.materialId)).toEqual([allowed])
      dbh.db.update(knowledgeBaseTable).set({ documentCount: 100 }).where(eq(knowledgeBaseTable.id, baseId)).run()
      expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([allowed])
    }
  )

  it.each(['天气', 'Go target'])('retains exclusion on the LIKE/relaxed-short-term path for %s', (query) => {
    const denied = material([query === '天气' ? '天气' : 'Go target'])
    const allowed = material([query === '天气' ? '今天天气很好' : 'target allowed'])
    save(denied)
    const snapshot = readKnowledgeGovernanceSearchSnapshot(baseId, store)
    const hits = store.search({ queryText: query, mode: 'bm25', topK: 1, exclusions: snapshot.exclusions })
    expect(hits.map((hit) => hit.materialId)).toEqual([allowed])
  })

  it('handles thousands of excluded IDs as bound data rather than SQL variables or source code', () => {
    const id = material()
    const unit = store.listMaterialUnits(id)[0]
    const unitIds = [...Array.from({ length: 4000 }, () => randomUUID()), unit.unitId, "x') OR 1=1 --"]
    expect(
      store.search({ queryText: 'target', mode: 'bm25', topK: 1, exclusions: { unitIds, materialIds: [] } })
    ).toEqual([])
    expect(store.listMaterialUnits(id)).toHaveLength(1)
  })

  it('does not exclude an allowed unit that shares the excluded unit embedding hash', async () => {
    const denied = material(['target'])
    const allowed = material(['target'])
    save(denied)
    dbh.db
      .update(knowledgeBaseTable)
      .set({ embeddingModelId, dimensions: 3 })
      .where(eq(knowledgeBaseTable.id, baseId))
      .run()
    expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([allowed])
    expect(embedMany).toHaveBeenCalledTimes(1)
  })

  it('sends only eligible candidates to the production rerank path and re-enables without losing labels', async () => {
    const id = material(['target blocked', 'target allowed'])
    const record = save(id)
    enableRerank()
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target allowed'])
    expect(rerank).toHaveBeenLastCalledWith(expect.objectContaining({ documents: ['target allowed'] }))
    const next = update(record, { ...record.state, excluded: false })
    expect(next.state.labels).toEqual(['private'])
    expect(next.state.overrideText).toBeNull()
    expect(await service.search(baseId, 'target')).toHaveLength(1)
    expect(rerank).toHaveBeenLastCalledWith(
      expect.objectContaining({ documents: expect.arrayContaining(['target blocked', 'target allowed']) })
    )
    expect(store.readMaterialContent(id)).toBe('target blocked\ntarget allowed')
  })

  it('fails closed for an unprepared correction while leaving other units searchable', async () => {
    const id = material(['target original', 'target other'])
    const record = save(id, 0, { excluded: false, labels: [], overrideText: 'corrected retrieval text' })
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target other'])
    expect(store.listMaterialUnits(id)[0].text).toBe('target original')
    update(record, { ...record.state, overrideText: null })
    expect(readKnowledgeGovernanceSearchSnapshot(baseId, store).exclusions).toEqual({ unitIds: [], materialIds: [] })
    expect(embedMany).not.toHaveBeenCalled()
  })

  it('reapplies exact decisions after same-content rebuild and reopening the disposable index', async () => {
    const id = material(['target excluded', 'target allowed'])
    const record = save(id)
    index(id, ['target excluded', 'target allowed'])
    store.close()
    store = new KnowledgeIndexStore(
      openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite')),
      betterSqlite3VectorIndex
    )
    getStore.mockReturnValue(store)
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target allowed'])
    expect(governance.get(baseId, id, record.unitId)).toEqual(record)
  })

  it.each(['source', 'chunking'])(
    'pauses a material after changed %s identity, retains evidence, and leaves other material available',
    async (change) => {
      const id = material(['target excluded', 'target allowed'])
      const record = save(id)
      const allowed = material(['target unaffected'])
      index(id, change === 'source' ? ['target changed', 'target allowed'] : ['target excluded\ntarget allowed'])
      expect(readKnowledgeGovernanceSearchSnapshot(baseId, store).exclusions.materialIds).toEqual([id])
      expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([allowed])
      expect(governance.get(baseId, id, record.unitId)).toEqual(record)
      expect(governance.listHistory(baseId, id, record.unitId)).toHaveLength(1)
    }
  )

  it.each(['sourceHash', 'text', 'offset', 'unitId', 'ownership'])(
    'does not authenticate a forged %s binding from storage alone',
    async (mismatch) => {
      const id = material(['target original'])
      const other = material(['target unaffected'])
      const unit = store.listMaterialUnits(id)[0]
      const source = {
        baseId,
        itemId: id,
        unitId: unit.unitId,
        sourceContentHash: hashContentText('target original'),
        charStart: unit.charStart,
        charEnd: unit.charEnd,
        originalText: unit.text
      }
      if (mismatch === 'sourceHash') source.sourceContentHash = 'a'.repeat(64)
      if (mismatch === 'text') source.originalText = 'x'.repeat(unit.text.length)
      if (mismatch === 'offset') {
        source.charStart += 1
        source.charEnd += 1
      }
      if (mismatch === 'unitId') source.unitId = 'b'.repeat(64)
      if (mismatch === 'ownership') source.unitId = store.listMaterialUnits(other)[0].unitId
      governance.create(source, { excluded: false, labels: [], overrideText: null })
      expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([other])
    }
  )

  it.each(['source-text', 'unit-index'] as const)(
    'pauses only the damaged %s material before all retrieval lanes and exposes review',
    async (kind) => {
      const id = material(['😀 target original'])
      const other = material(['target unaffected'])
      const record = save(id, 0, { excluded: false, labels: ['kept'], overrideText: null })
      const driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
      try {
        if (kind === 'source-text')
          driver.execute('UPDATE content SET text = ? WHERE content_hash = ?', [
            'x'.repeat(record.originalText.length),
            record.sourceContentHash
          ])
        else driver.execute('UPDATE search_unit SET unit_index = 7 WHERE material_id = ?', [id])
      } finally {
        driver.close()
      }
      const snapshot = readKnowledgeGovernanceSearchSnapshot(baseId, store)
      expect(snapshot.exclusions.materialIds).toEqual([id])
      for (const mode of ['bm25', 'vector', 'hybrid'] as const) {
        expect(
          store
            .search({ queryText: 'target', queryEmbedding: [1, 0, 0], mode, topK: 10, exclusions: snapshot.exclusions })
            .map((hit) => hit.materialId)
        ).toEqual([other])
      }
      expect((await service.search(baseId, 'target')).map((hit) => hit.itemId)).toEqual([other])
      expect(workflow.listReviews(baseId, id).records.map((row) => row.id)).toEqual([record.id])
      expect(governance.get(baseId, id, record.unitId)).toEqual(record)
    }
  )

  it('rejects a newly committed exclusion before any stale candidate reaches the reranker', async () => {
    const id = material()
    enableRerank()
    const search = store.search.bind(store)
    vi.spyOn(store, 'search').mockImplementationOnce((input) => {
      const hits = search(input)
      save(id)
      return hits
    })
    await expect(service.search(baseId, 'target')).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(rerank).not.toHaveBeenCalled()
  })

  it('rejects a changed revision before reranking, including label-only changes', async () => {
    const id = material()
    const record = save(id, 0, { excluded: false, labels: [], overrideText: null })
    enableRerank()
    const search = store.search.bind(store)
    vi.spyOn(store, 'search').mockImplementationOnce((input) => {
      const hits = search(input)
      update(record, { ...record.state, labels: ['new label'] })
      return hits
    })
    await expect(service.search(baseId, 'target')).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(rerank).not.toHaveBeenCalled()
  })

  it('withholds a late excluded result after reranking without repeating a provider call', async () => {
    const id = material()
    const record = save(id, 0, { excluded: false, labels: [], overrideText: null })
    enableRerank()
    let signalStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    rerank.mockImplementationOnce(async () => {
      signalStarted()
      await gate
      return { ranking: [{ originalIndex: 0, score: 1 }] }
    })
    const pending = service.search(baseId, 'target')
    await started
    update(record, { ...record.state, excluded: true })
    release()
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(rerank).toHaveBeenCalledTimes(1)
    expect(await service.search(baseId, 'target')).toEqual([])
    expect(rerank).toHaveBeenCalledTimes(1)
  })

  it.each(['before-rerank', 'after-rerank'])(
    'detects an identity-changing rebuild %s even when the durable revision did not change',
    async (phase) => {
      const id = material()
      const record = save(id, 0, { excluded: false, labels: [], overrideText: null })
      enableRerank()
      const rebuild = () => index(id, ['target different source'])
      if (phase === 'before-rerank') {
        const search = store.search.bind(store)
        vi.spyOn(store, 'search').mockImplementationOnce((input) => {
          const hits = search(input)
          rebuild()
          return hits
        })
      } else {
        rerank.mockImplementationOnce(async () => {
          rebuild()
          return { ranking: [{ originalIndex: 0, score: 1 }] }
        })
      }
      await expect(service.search(baseId, 'target')).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      expect(governance.get(baseId, id, record.unitId)?.revision).toBe(1)
      expect(rerank).toHaveBeenCalledTimes(phase === 'before-rerank' ? 0 : 1)
    }
  )

  it('fails closed when decision revalidation cannot read its source of truth', async () => {
    material()
    enableRerank()
    const list = governance.listByBase.bind(governance)
    vi.spyOn(governance, 'listByBase')
      .mockImplementationOnce(list)
      .mockImplementationOnce(() => {
        throw new Error('database unavailable')
      })
    await expect(service.search(baseId, 'target')).rejects.toThrow('database unavailable')
    expect(rerank).not.toHaveBeenCalled()
  })

  it('keeps original source reads and chunk inspection distinct from retrieval exclusion', async () => {
    const id = material(['target hidden', 'target visible'])
    save(id)
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target visible'])
    expect((await service.listItemChunks(baseId, id)).map((chunk) => chunk.content)).toEqual([
      'target hidden',
      'target visible'
    ])
    expect(store.readMaterialContent(id)).toBe('target hidden\ntarget visible')
  })

  it('validates UTF-16 offsets without confusing emoji with SQLite character counts', async () => {
    const id = material(['😀 é target private', '中文 target visible'])
    const record = save(id)
    expect(record.charEnd).toBe('😀 é target private'.length)
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['中文 target visible'])
  })

  it('scopes durable policy reads to the requested base with deterministic ordering', () => {
    const id = material(['target one', 'target two'])
    const one = save(id, 0)
    const two = save(id, 1)
    expect(governance.listByBase(baseId).map((row) => row.id)).toEqual([one.id, two.id].sort())
    expect(governance.listByBase('22222222-2222-4222-8222-222222222222')).toEqual([])
  })

  it.each([false, true])(
    'translates index closure during reranking with governance=%s to an operation failure',
    async (governed) => {
      const id = material()
      if (governed) save(id, 0, { excluded: false, labels: [], overrideText: null })
      enableRerank()
      rerank.mockImplementationOnce(async () => {
        store.close()
        return { ranking: [{ originalIndex: 0, score: 1 }] }
      })
      await expect(service.search(baseId, 'target')).rejects.toMatchObject({ code: ErrorCode.INVALID_OPERATION })
    }
  )

  // Review must move only explicitly accepted intent, never fuzzy-match or revive retired decisions.
  function reviewInput(itemId: string, governanceId: string) {
    const view = workflow.listReviews(baseId, itemId)
    const row = view.records.find((row) => row.id === governanceId)!
    return {
      baseId,
      itemId,
      governanceId,
      expectedRevision: row.revision,
      currentSourceContentHash: view.currentSourceContentHash
    }
  }

  it('rebinds exact selected originals atomically, keeping corrections pending and both audit links', async () => {
    const id = material(['old target'])
    const old = save(id, 0, { excluded: false, labels: ['reviewed'], overrideText: 'User corrected target' })
    index(id, ['new target', 'target untouched'])
    const view = workflow.listReviews(baseId, id)
    expect(view.records).toMatchObject([{ id: old.id, originalText: 'old target', reason: 'source-changed' }])
    expect(await service.search(baseId, 'target')).toEqual([])
    const source = store.readMaterialContent(id)
    const units = store.listMaterialUnits(id)
    await workflow.review({
      ...reviewInput(id, old.id),
      action: {
        kind: 'rebind',
        targetUnitId: units[0].unitId,
        expectedTargetRevision: 0
      }
    })
    const next = governance.get(baseId, id, units[0].unitId)!
    expect(next.state).toEqual(old.state)
    expect(next.originalText).toBe('new target')
    expect(next.sourceContentHash).not.toBe(old.sourceContentHash)
    expect(governance.get(baseId, id, old.unitId)).toMatchObject({
      retired: true,
      revision: 2,
      originalText: 'old target',
      state: { excluded: false, labels: [], overrideText: null }
    })
    expect(governance.listHistory(baseId, id, old.unitId)).toMatchObject([
      { revision: 1, state: old.state, operation: 'edit' },
      { revision: 2, operation: 'rebind-away', relatedGovernanceId: next.id }
    ])
    expect(governance.listHistory(baseId, id, next.unitId)).toMatchObject([
      { revision: 1, operation: 'rebind-from', relatedGovernanceId: old.id }
    ])
    expect(workflow.listReviews(baseId, id).records).toEqual([])
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target untouched'])
    expect((await service.listItemChunks(baseId, id))[0].governance?.status).toBe('pending')
    expect(store.readMaterialContent(id)).toBe(source)
    expect(store.listMaterialUnits(id)).toEqual(units)
    expect(embedMany).not.toHaveBeenCalled()
  })

  it.each(['bm25', 'vector', 'hybrid'] as const)(
    'rebound exclusions take effect in %s before retrieval',
    async (mode) => {
      const id = material(['old target'])
      const old = save(id)
      index(id, ['new target excluded', 'target allowed'])
      const [unit] = store.listMaterialUnits(id)
      await workflow.review({
        ...reviewInput(id, old.id),
        action: { kind: 'rebind', targetUnitId: unit.unitId, expectedTargetRevision: 0 }
      })
      const exclusions = readKnowledgeGovernanceSearchSnapshot(baseId, store).exclusions
      expect(
        store
          .search({ queryText: 'target', queryEmbedding: [1, 0, 0], mode, topK: 1, exclusions })
          .map((hit) => hit.text)
      ).toEqual(['target allowed'])
    }
  )

  it.each(['empty', 'unavailable'] as const)(
    'exposes and discards %s source decisions without erasing evidence',
    async (state) => {
      const id = material(['old target'])
      const old = save(id)
      if (state === 'empty') index(id, [])
      else await store.deleteMaterials([id])
      expect(await service.listItemChunks(baseId, id)).toEqual([])
      const view = workflow.listReviews(baseId, id)
      expect(view.records[0]).toMatchObject({
        originalText: 'old target',
        id: old.id,
        reason: state === 'empty' ? 'source-changed' : 'source-unavailable'
      })
      expect(view.currentSourceContentHash).toBe(state === 'empty' ? hashContentText('') : null)
      const dto = { ...reviewInput(id, old.id), action: { kind: 'discard' as const } }
      await workflow.review(dto)
      expect(workflow.listReviews(baseId, id).records).toMatchObject([{ id: old.id, retired: true, state: old.state }])
      expect(governance.listHistory(baseId, id, old.unitId)).toMatchObject([
        { revision: 1, state: old.state },
        { revision: 2, operation: 'discard' }
      ])
      index(id, ['old target'])
      expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['old target'])
      await expect(workflow.review(dto)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      expect(governance.listHistory(baseId, id, old.unitId)).toHaveLength(2)
      expect(embedMany).not.toHaveBeenCalled()
    }
  )

  it('retains a material pause until every unmatched record is explicitly resolved', async () => {
    const id = material(['old target one', 'old target two'])
    const one = save(id, 0),
      two = save(id, 1)
    index(id, ['target current'])
    await workflow.review({ ...reviewInput(id, one.id), action: { kind: 'discard' } })
    expect(
      workflow
        .listReviews(baseId, id)
        .records.filter((row) => !row.retired)
        .map((row) => row.id)
    ).toEqual([two.id])
    expect(await service.search(baseId, 'target')).toEqual([])
    await workflow.review({ ...reviewInput(id, two.id), action: { kind: 'discard' } })
    expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['target current'])
  })

  it('refuses stale source, source revision and competing target decisions without changing history', async () => {
    const id = material(['old target'])
    const old = save(id)
    index(id, ['new target'])
    const dto = reviewInput(id, old.id)
    index(id, ['newer target'])
    await expect(workflow.review({ ...dto, action: { kind: 'discard' } })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
    const current = reviewInput(id, old.id)
    update(old, { ...old.state, labels: ['newer intent'] })
    await expect(workflow.review({ ...current, action: { kind: 'discard' } })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
    const target = save(id, 0, { excluded: false, labels: ['target intent'], overrideText: null })
    const originalRows = governance.listByBase(baseId)
    await expect(
      workflow.review({
        ...reviewInput(id, old.id),
        action: { kind: 'rebind', targetUnitId: target.unitId, expectedTargetRevision: 1 }
      })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual(originalRows)
    expect(governance.listHistory(baseId, id, old.unitId)).toHaveLength(2)
    expect(governance.listHistory(baseId, id, target.unitId)).toHaveLength(1)
  })

  it('rolls back both transfer sides and audit links on an injected source-history failure', async () => {
    const id = material(['old target'])
    const old = save(id)
    index(id, ['new target'])
    const [target] = store.listMaterialUnits(id)
    dbh.sqlite.exec(`CREATE TEMP TRIGGER fail_review_history BEFORE INSERT ON knowledge_chunk_governance_history
      WHEN NEW.operation = 'rebind-away' BEGIN SELECT RAISE(ABORT, 'review history failure'); END`)
    try {
      await expect(
        workflow.review({
          ...reviewInput(id, old.id),
          action: { kind: 'rebind', targetUnitId: target.unitId, expectedTargetRevision: 0 }
        })
      ).rejects.toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_review_history')
    }
    expect(governance.listByBase(baseId)).toEqual([old])
    expect(governance.listHistory(baseId, id, old.unitId)).toHaveLength(1)
    expect(governance.listHistory(baseId, id, target.unitId)).toEqual([])
  })

  it('does not auto-review same-identity rebuilds, and rechecks lifecycle after mutation-lock wait', async () => {
    const id = material(['old target'])
    const old = save(id)
    index(id, ['old target'])
    expect(workflow.listReviews(baseId, id).records).toEqual([])
    index(id, ['new target'])
    const dto = reviewInput(id, old.id)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = lock.runExclusive(baseId, async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await started
    const pending = workflow.review({ ...dto, action: { kind: 'discard' } })
    dbh.db.update(knowledgeItemTable).set({ status: 'deleting' }).where(eq(knowledgeItemTable.id, id)).run()
    release()
    await held
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.listByBase(baseId)).toEqual([old])
  })

  it('never accepts a different source as the target or revives retired intent after a rebuild', async () => {
    const id = material(['old target'])
    const old = save(id)
    index(id, ['new target'])
    const foreign = material(['foreign target'])
    const unit = store.listMaterialUnits(foreign)[0]
    await expect(
      workflow.review({
        ...reviewInput(id, old.id),
        action: { kind: 'rebind', targetUnitId: unit.unitId, expectedTargetRevision: 0 }
      })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
    index(id, ['old target'])
    const selected = (await selection(id))[0]
    expect(selected.expectedRevision).toBe(2)
    await workflow.apply({
      baseId,
      selection: [selected],
      action: { kind: 'label', operation: 'add', label: 'new intent' }
    })
    expect(governance.get(baseId, id, old.unitId)).toMatchObject({
      retired: false,
      revision: 3,
      state: { excluded: false, labels: ['new intent'], overrideText: null }
    })
  })

  it('allows an explicit transfer back to a retired identity without rewriting either original history', async () => {
    const id = material(['old target'])
    const old = save(id)
    index(id, ['new target'])
    const [unit] = store.listMaterialUnits(id)
    await workflow.review({
      ...reviewInput(id, old.id),
      action: { kind: 'rebind', targetUnitId: unit.unitId, expectedTargetRevision: 0 }
    })
    const moved = governance.get(baseId, id, unit.unitId)!
    index(id, ['old target'])
    await workflow.review({
      ...reviewInput(id, moved.id),
      action: { kind: 'rebind', targetUnitId: old.unitId, expectedTargetRevision: 2 }
    })
    expect(governance.get(baseId, id, old.unitId)).toMatchObject({
      retired: false,
      revision: 3,
      state: old.state,
      originalText: old.originalText
    })
    expect(governance.listHistory(baseId, id, old.unitId)).toMatchObject([
      { revision: 1, state: old.state, operation: 'edit' },
      { revision: 2, operation: 'rebind-away', relatedGovernanceId: moved.id },
      { revision: 3, operation: 'rebind-from', relatedGovernanceId: moved.id }
    ])
    expect(governance.get(baseId, id, moved.unitId)?.retired).toBe(true)
    expect(workflow.listReviews(baseId, id).records).toEqual([])
    expect(await service.search(baseId, 'target')).toEqual([])
  })

  // Undo must recover only the latest discard, retain immutable evidence, and pause changed sources again.
  it.each(['changed', 'same', 'unavailable'] as const)(
    'restores discarded intent safely with %s source evidence',
    async (source) => {
      const id = material(['old target'])
      const old = save(id, 0, { excluded: true, labels: ['private'], overrideText: 'Pending correction' })
      index(id, ['new target'])
      await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
      if (source === 'same') index(id, ['old target'])
      if (source === 'unavailable') await store.deleteMaterials([id])
      const dto = { ...reviewInput(id, old.id), action: { kind: 'restore' as const } }
      const content = store.readMaterialContent(id)
      const units = store.listMaterialUnits(id)
      await workflow.review(dto)
      expect(governance.get(baseId, id, old.unitId)).toMatchObject({
        retired: false,
        revision: 3,
        originalText: old.originalText,
        sourceContentHash: old.sourceContentHash,
        state: old.state
      })
      expect(governance.listHistory(baseId, id, old.unitId)).toMatchObject([
        { revision: 1, state: old.state },
        { revision: 2, operation: 'discard' },
        { revision: 3, operation: 'restore-discard', state: old.state }
      ])
      expect(workflow.listReviews(baseId, id).records.filter((row) => !row.retired)).toHaveLength(
        source === 'same' ? 0 : 1
      )
      expect(await service.search(baseId, 'target')).toEqual([])
      const exclusions = readKnowledgeGovernanceSearchSnapshot(baseId, store).exclusions
      for (const mode of ['bm25', 'vector', 'hybrid'] as const)
        expect(store.search({ queryText: 'target', queryEmbedding: [1, 0, 0], mode, topK: 10, exclusions })).toEqual([])
      expect(store.readMaterialContent(id)).toBe(content)
      expect(store.listMaterialUnits(id)).toEqual(units)
      expect(embedMany).not.toHaveBeenCalled()
      await expect(workflow.review(dto)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    }
  )

  it('refuses stale restore evidence, source ownership and edits that have superseded a discard', async () => {
    const id = material(['old target']),
      old = save(id)
    index(id, ['new target'])
    await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
    const dto = { ...reviewInput(id, old.id), action: { kind: 'restore' as const } }
    index(id, ['newer target'])
    await expect(workflow.review(dto)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    const current = { ...reviewInput(id, old.id), action: { kind: 'restore' as const } }
    const foreign = material(['foreign target'])
    await expect(workflow.review({ ...current, itemId: foreign })).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    index(id, ['old target'])
    await workflow.apply({
      baseId,
      selection: await selection(id),
      action: { kind: 'label', operation: 'add', label: 'new intent' }
    })
    await expect(workflow.review(current)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(workflow.listReviews(baseId, id).records).toEqual([])
    expect(governance.get(baseId, id, old.unitId)?.state.labels).toEqual(['new intent'])
  })

  it('never offers Undo for a transfer and refuses direct restoration of transfer history', async () => {
    const id = material(['old target']),
      old = save(id)
    index(id, ['new target'])
    await workflow.review({
      ...reviewInput(id, old.id),
      action: { kind: 'rebind', targetUnitId: store.listMaterialUnits(id)[0].unitId, expectedTargetRevision: 0 }
    })
    expect(workflow.listReviews(baseId, id).records).toEqual([])
    expect(() => governance.restoreDiscard({ baseId, itemId: id, governanceId: old.id, expectedRevision: 2 })).toThrow(
      'Only the latest unchanged discard can be restored'
    )
    expect(governance.get(baseId, id, old.unitId)?.retired).toBe(true)
  })

  it('rolls back restored state if appending its history fails', async () => {
    const id = material(['old target']),
      old = save(id)
    index(id, ['new target'])
    await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
    const before = governance.listByBase(baseId)
    dbh.sqlite.exec(`CREATE TEMP TRIGGER fail_restore_history BEFORE INSERT ON knowledge_chunk_governance_history
      WHEN NEW.revision = 3 BEGIN SELECT RAISE(ABORT, 'restore history failure'); END`)
    try {
      await expect(workflow.review({ ...reviewInput(id, old.id), action: { kind: 'restore' } })).rejects.toThrow()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_restore_history')
    }
    expect(governance.listByBase(baseId)).toEqual(before)
    expect(governance.listHistory(baseId, id, old.unitId)).toHaveLength(2)
  })

  it('rechecks lifecycle under the real mutation lock before restoring', async () => {
    const id = material(['old target']),
      old = save(id)
    index(id, ['new target'])
    await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
    const dto = { ...reviewInput(id, old.id), action: { kind: 'restore' as const } }
    let release!: () => void, entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = lock.runExclusive(baseId, async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await started
    const pending = workflow.review(dto)
    dbh.db.update(knowledgeItemTable).set({ status: 'deleting' }).where(eq(knowledgeItemTable.id, id)).run()
    release()
    await held
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(governance.get(baseId, id, old.unitId)?.retired).toBe(true)
  })

  it('keeps immutable history through repeated discard/restore without affecting another material', async () => {
    const id = material(['old target']),
      old = save(id)
    const other = material(['other target'])
    dbh.db.update(knowledgeBaseTable).set({ documentCount: 10 }).where(eq(knowledgeBaseTable.id, baseId)).run()
    index(id, ['new target'])
    for (let cycle = 0; cycle < 2; cycle++) {
      await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'discard' } })
      expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent).sort()).toEqual([
        'new target',
        'other target'
      ])
      await workflow.review({ ...reviewInput(id, old.id), action: { kind: 'restore' } })
      expect((await service.search(baseId, 'target')).map((hit) => hit.pageContent)).toEqual(['other target'])
    }
    expect(governance.get(baseId, id, old.unitId)).toMatchObject({ revision: 5, retired: false, state: old.state })
    expect(governance.listHistory(baseId, id, old.unitId).map((row) => row.operation)).toEqual([
      'edit',
      'discard',
      'restore-discard',
      'discard',
      'restore-discard'
    ])
    expect(governance.listByBase(baseId).some((row) => row.itemId === other)).toBe(false)
  })
})
