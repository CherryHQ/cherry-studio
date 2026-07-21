import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { describe, expect, it } from 'vitest'

import { hashEmbeddingText } from '../../vectorstore/indexStore/hashing'
import type { RebuildMaterialInput } from '../../vectorstore/indexStore/model'
import {
  captureNoteSnapshotFileMock,
  captureUrlSnapshotFileMock,
  createAbortedCtx,
  createBase,
  createCtx,
  createFileItem,
  createIndexDocumentsJobHandler,
  createJobSnapshot,
  createNoteItem,
  createUrlItem,
  embedKnowledgeTextsMock,
  fakeEmbedVector,
  fetchKnowledgeWebPageMock,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateSnapshotRelativePathMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  listExistingEmbeddingHashesMock,
  loadKnowledgeItemDocumentsMock,
  loggerWarnMock,
  NOTE_ITEM_ID,
  rebuildMaterialMock,
  refineLocalEmbeddingChunksMock
} from './jobHandlerTestUtils'

/** Documents whose single-chunk bodies are exactly these strings (no trimming). */
const DISTINCT_DOCS = ['alpha', 'bravo', 'charlie']

function distinctDocuments() {
  return DISTINCT_DOCS.map((text) => ({ text, metadata: { source: NOTE_ITEM_ID } }))
}

/**
 * Word-spaced (not a single featureless run) so the splitter's average
 * chars-per-token estimate stays realistic and chunkSize:50 reliably yields far
 * more than one embedding batch (batch size 10).
 */
function manyChunksText(): string {
  return Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ')
}

function lastRebuildInput(): RebuildMaterialInput {
  return rebuildMaterialMock.mock.calls[0][1] as RebuildMaterialInput
}

describe('index-documents job handler', () => {
  it('updates statuses, writes vectors, and completes the item', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(rebuildMaterialMock).toHaveBeenCalledWith(
      NOTE_ITEM_ID,
      expect.objectContaining({
        content: expect.objectContaining({ text: 'hello world' }),
        units: expect.arrayContaining([expect.objectContaining({ unitType: 'chunk' })]),
        embeddings: expect.any(Array)
      })
    )
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
    expect(handler.defaultQueue?.({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null })).toBe('base.kb-1')
  })

  it('pairs every embedding vector with the hash of the body it was computed from', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce(distinctDocuments())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    const input = lastRebuildInput()
    expect(input.embeddings.length).toBeGreaterThanOrEqual(3)
    // Reconstruct each unit's body exactly as the store does (verbatim slice),
    // then assert the vector stored under that body's hash is the embedding of
    // that body — a mis-pairing would put the wrong vector under the hash.
    const bodyByHash = new Map<string, string>()
    for (const unit of input.units) {
      const body = input.content.text.slice(unit.charStart, unit.charEnd)
      bodyByHash.set(hashEmbeddingText(body), body)
    }
    for (const embedding of input.embeddings) {
      const body = bodyByHash.get(embedding.embeddingTextHash)
      expect(body, `no unit body hashes to ${embedding.embeddingTextHash}`).toBeDefined()
      expect(embedding.vector).toEqual(fakeEmbedVector(body as string))
    }
  })

  it('reuses already-stored embeddings and only embeds the missing chunk bodies (decision A4)', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce(distinctDocuments())
    // 'bravo' is already in the index; reindexing must not re-embed it.
    const storedHash = hashEmbeddingText('bravo')
    listExistingEmbeddingHashesMock.mockResolvedValueOnce(new Set([storedHash]))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    // The paid embed call received only the two missing bodies.
    const embeddedBodies = embedKnowledgeTextsMock.mock.calls[0][1] as string[]
    expect(embeddedBodies).not.toContain('bravo')
    expect(embeddedBodies).toEqual(expect.arrayContaining(['alpha', 'charlie']))

    // rebuildMaterial is handed embeddings only for the missing hashes; the stored
    // hash is reused in-store (INSERT OR IGNORE), so re-supplying it is pointless.
    const writtenHashes = lastRebuildInput().embeddings.map((embedding) => embedding.embeddingTextHash)
    expect(writtenHashes).not.toContain(storedHash)
    expect(writtenHashes).toEqual(expect.arrayContaining([hashEmbeddingText('alpha'), hashEmbeddingText('charlie')]))
  })

  it('embeds large items in batches, reporting incremental progress via the shared cache', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeBaseGetByIdMock.mockReturnValue(createBase({ chunkSize: 50, chunkOverlap: 0 }))
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([
      { text: manyChunksText(), metadata: { source: NOTE_ITEM_ID } }
    ])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(embedKnowledgeTextsMock.mock.calls.length).toBeGreaterThan(1)
    for (const call of embedKnowledgeTextsMock.mock.calls) {
      expect((call[1] as string[]).length).toBeLessThanOrEqual(10)
    }

    const progressKey = `knowledge.item.embedding_progress.${NOTE_ITEM_ID}`
    const cacheService = MockMainCacheServiceExport.cacheService
    const progressCalls = cacheService.setShared.mock.calls.filter(([key]) => key === progressKey)
    const progressValues = progressCalls.map(([, value]) => value as number)
    // 0 as the batch loop starts, then non-decreasing per-batch updates ending at 100%.
    expect(progressValues[0]).toBe(0)
    expect(progressValues.at(-1)).toBe(100)
    expect(progressValues).toEqual([...progressValues].sort((a, b) => a - b))
    // Active writes never carry a TTL — a slow batch or material write must not let
    // the value expire mid-run. Only the final linger write does, purely as GC.
    const activeCalls = progressCalls.slice(0, -1)
    for (const call of activeCalls) {
      expect(call[2]).toBeUndefined()
    }
    expect(progressCalls.at(-1)?.[2]).toEqual(expect.any(Number))
    // A prior run's leftover is cleared as this run enters the embedding phase,
    // before any fresh percentage is published.
    const deleteSharedCallOrder = cacheService.deleteShared.mock.calls.findIndex(([key]) => key === progressKey)
    expect(deleteSharedCallOrder).toBeGreaterThanOrEqual(0)
    const deleteSharedInvocationOrder = cacheService.deleteShared.mock.invocationCallOrder[deleteSharedCallOrder]
    const firstProgressInvocationOrder =
      cacheService.setShared.mock.invocationCallOrder[
        cacheService.setShared.mock.calls.findIndex(([key]) => key === progressKey)
      ]
    expect(deleteSharedInvocationOrder).toBeLessThan(firstProgressInvocationOrder)
    // The value must outlive the job — the list status is polled, so a completion
    // that removed the key would blank the percentage until the next poll. The exit
    // path is a single same-value TTL'd write (setShared broadcasts TTL-only
    // changes; no deletion event that could flicker a mounted badge), landing only
    // after the item flips to 'completed'.
    expect(cacheService.getShared(progressKey)).toBe(100)
    const completedCallOrder = knowledgeItemUpdateStatusMock.mock.calls.findIndex(
      ([, status]) => status === 'completed'
    )
    const completedInvocationOrder = knowledgeItemUpdateStatusMock.mock.invocationCallOrder[completedCallOrder]
    const lingerCallIndex = cacheService.setShared.mock.calls.lastIndexOf(progressCalls.at(-1)!)
    const lingerInvocationOrder = cacheService.setShared.mock.invocationCallOrder[lingerCallIndex]
    expect(lingerInvocationOrder).toBeGreaterThan(completedInvocationOrder)
    // Exactly one deletion for the key across the whole run — the run-start stale
    // clear. The exit path must not delete (a deletion event blanks the badge).
    expect(cacheService.deleteShared.mock.calls.filter(([key]) => key === progressKey)).toHaveLength(1)
  })

  it('stops embedding more batches once the job is aborted mid-loop', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeBaseGetByIdMock.mockReturnValue(createBase({ chunkSize: 50, chunkOverlap: 0 }))
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([
      { text: manyChunksText(), metadata: { source: NOTE_ITEM_ID } }
    ])
    const controller = new AbortController()
    embedKnowledgeTextsMock.mockImplementationOnce(async (_base: unknown, values: string[]) => {
      // Simulate cancellation arriving while the first batch is in flight.
      controller.abort()
      return values.map(fakeEmbedVector)
    })

    const ctx = {
      ...createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }),
      signal: controller.signal
    }

    await expect(handler.execute(ctx)).rejects.toThrow()

    expect(embedKnowledgeTextsMock).toHaveBeenCalledTimes(1)
    expect(rebuildMaterialMock).not.toHaveBeenCalled()
    // The exit path converts the partial percentage into a TTL'd leftover even on
    // abort — never a mid-run deletion, never a TTL-free leak.
    const progressKey = `knowledge.item.embedding_progress.${NOTE_ITEM_ID}`
    const cacheService = MockMainCacheServiceExport.cacheService
    const lastProgressCall = cacheService.setShared.mock.calls.filter(([key]) => key === progressKey).at(-1)
    expect(lastProgressCall?.[2]).toEqual(expect.any(Number))
  })

  it('does not run local token-limit refinement for non-local embedding models', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce(distinctDocuments())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(refineLocalEmbeddingChunksMock).not.toHaveBeenCalled()
    expect(embedKnowledgeTextsMock.mock.calls[0][1]).toEqual(DISTINCT_DOCS)
  })

  it('embeds refined local-embedding chunks instead of the oversized original body', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeBaseGetByIdMock.mockReturnValue(
      createBase({
        embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
        dimensions: 1024
      })
    )
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([{ text: 'abcdefghij', metadata: { source: NOTE_ITEM_ID } }])
    refineLocalEmbeddingChunksMock.mockImplementationOnce(async (_base, chunked) => ({
      contentText: chunked.contentText,
      chunks: [
        { unitIndex: 0, charStart: 0, charEnd: 4, text: 'abcd' },
        { unitIndex: 1, charStart: 4, charEnd: 8, text: 'efgh' },
        { unitIndex: 2, charStart: 8, charEnd: 10, text: 'ij' }
      ]
    }))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(refineLocalEmbeddingChunksMock).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID }),
      expect.objectContaining({
        contentText: 'abcdefghij',
        chunks: [expect.objectContaining({ text: 'abcdefghij' })]
      }),
      expect.any(AbortSignal)
    )
    expect(embedKnowledgeTextsMock.mock.calls[0][1]).toEqual(['abcd', 'efgh', 'ij'])
    expect(
      lastRebuildInput().units.map((unit) => lastRebuildInput().content.text.slice(unit.charStart, unit.charEnd))
    ).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('embeds nothing when every chunk body is already stored (full A4 reuse)', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce(distinctDocuments())
    listExistingEmbeddingHashesMock.mockResolvedValueOnce(new Set(DISTINCT_DOCS.map(hashEmbeddingText)))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    // The batch loop has nothing to embed, so the paid embed seam is never
    // called at all, and the rebuild reuses the stored vectors: no embeddings
    // re-supplied.
    expect(embedKnowledgeTextsMock).not.toHaveBeenCalled()
    expect(lastRebuildInput().embeddings).toEqual([])
    expect(lastRebuildInput().units).toHaveLength(DISTINCT_DOCS.length)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
    // With nothing to embed there is no progress either — publishing 0% here
    // would show a "vectorizing 0%" row for work that never happens.
    expect(
      MockMainCacheServiceExport.cacheService.setShared.mock.calls.filter(
        ([key]) => key === `knowledge.item.embedding_progress.${NOTE_ITEM_ID}`
      )
    ).toHaveLength(0)
  })

  it('skips embedding entirely for a BM25-only base and writes only lexical text', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    // A base without an embedding model is BM25-only: no dimensions, lexical search.
    knowledgeBaseGetByIdMock.mockReturnValue({
      ...createBase(),
      embeddingModelId: null,
      dimensions: null
    })
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce(distinctDocuments())

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    // No paid embed round-trip and no existing-hash lookup for a lexical base.
    expect(embedKnowledgeTextsMock).not.toHaveBeenCalled()
    expect(listExistingEmbeddingHashesMock).not.toHaveBeenCalled()

    const input = lastRebuildInput()
    expect(input.usesEmbeddings).toBe(false)
    expect(input.embeddings).toEqual([])
    expect(input.units).toHaveLength(DISTINCT_DOCS.length)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
    // A lexical base never embeds, so it must not publish a percentage — the row
    // would otherwise sit at "vectorizing 0%" with no embedding request in flight.
    expect(
      MockMainCacheServiceExport.cacheService.setShared.mock.calls.filter(
        ([key]) => key === `knowledge.item.embedding_progress.${NOTE_ITEM_ID}`
      )
    ).toHaveLength(0)
  })

  it('warns when an item yields no indexable text, and still completes it with an empty material', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    // An image-only PDF or failed extraction must leave a diagnosable trace —
    // without the warn it would look indexed while matching nothing.
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Knowledge item produced no indexable text; it will complete with an empty index',
      expect.objectContaining({ baseId: 'kb-1', itemId: NOTE_ITEM_ID })
    )
    expect(lastRebuildInput().units).toEqual([])
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('uses the processed-artifact path (indexedRelativePath) as the material relative path', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    const fileItem = createFileItem(FILE_ITEM_ID)
    fileItem.data.indexedRelativePath = 'source.md'
    knowledgeItemGetByIdMock.mockReturnValue(fileItem)
    knowledgeItemUpdateStatusMock.mockReturnValue(fileItem)

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: FILE_ITEM_ID, parentJobId: null }))

    expect(lastRebuildInput().material.relativePath).toBe('source.md')
  })

  it('passes file items to the reader without a fileEntry override', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createFileItem(FILE_ITEM_ID))

    await handler.execute(
      createCtx({
        baseId: 'kb-1',
        itemId: FILE_ITEM_ID,
        parentJobId: null
      })
    )

    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(expect.objectContaining({ id: FILE_ITEM_ID }))
  })

  it('completes with empty vectors when the reader returns no documents', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    loadKnowledgeItemDocumentsMock.mockResolvedValueOnce([])

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'reading')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'embedding')
    expect(rebuildMaterialMock).toHaveBeenCalledWith(
      NOTE_ITEM_ID,
      expect.objectContaining({ content: expect.objectContaining({ text: '' }), units: [], embeddings: [] })
    )
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('skips vector write when the item becomes deleting inside the mutation lock', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(createNoteItem(NOTE_ITEM_ID))
      .mockReturnValueOnce(createNoteItem(NOTE_ITEM_ID, null, 'deleting'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(rebuildMaterialMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('does not mark completed when vector replacement fails', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID))
    rebuildMaterialMock.mockRejectedValueOnce(new Error('vector write failed'))

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    ).rejects.toThrow('vector write failed')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('stops before side effects when aborted before execution', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)

    await expect(
      handler.execute(createAbortedCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    ).rejects.toThrow()

    expect(knowledgeBaseGetByIdMock).not.toHaveBeenCalled()
    expect(rebuildMaterialMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('captures a URL snapshot on first index, persists its relativePath, and reads it offline', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    // A freshly added / migrated URL has no snapshot yet (returned both at load
    // time and at the in-lock re-read).
    knowledgeItemGetByIdMock.mockReturnValue(createUrlItem('url-1'))
    captureUrlSnapshotFileMock.mockResolvedValue('example-page.md')

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'url-1', parentJobId: null }))

    // Fetched exactly once, snapshot written, relativePath persisted.
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledTimes(1)
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledWith('https://example.com', expect.anything())
    expect(captureUrlSnapshotFileMock).toHaveBeenCalledWith(
      'kb-1',
      'https://example.com',
      '# Example page\n\nbody text',
      expect.any(Set)
    )
    expect(knowledgeItemUpdateSnapshotRelativePathMock).toHaveBeenCalledWith('url-1', 'url', 'example-page.md')
    // The reader receives the item carrying the freshly captured snapshot path.
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'url-1', data: expect.objectContaining({ relativePath: 'example-page.md' }) })
    )
    // The material's relative_path is the real snapshot path under `raw/`, not the
    // item-id virtual placeholder — so it points at the bytes captureUrlSnapshotFile
    // wrote and agrees with what the v1→v2 migrator stamps for the same url.
    expect(lastRebuildInput().material.relativePath).toBe('example-page.md')
  })

  it('does not fetch a URL that already has a captured snapshot', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createUrlItem('url-1', 'cached.md'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'url-1', parentJobId: null }))

    expect(fetchKnowledgeWebPageMock).not.toHaveBeenCalled()
    expect(captureUrlSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateSnapshotRelativePathMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relativePath: 'cached.md' }) })
    )
  })

  it('skips the snapshot write when another job captured it while this one fetched', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    // Load sees no snapshot; the in-lock re-read sees one a concurrent job wrote.
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(createUrlItem('url-1'))
      .mockReturnValueOnce(createUrlItem('url-1', 'raced.md'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: 'url-1', parentJobId: null }))

    // Fetched before the lock, but the duplicate write/persist is skipped.
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledTimes(1)
    expect(captureUrlSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateSnapshotRelativePathMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relativePath: 'raced.md' }) })
    )
    // The material is stamped with the raced snapshot path too — the concurrently
    // captured file, not the item-id placeholder.
    expect(lastRebuildInput().material.relativePath).toBe('raced.md')
  })

  it('fails the index when a URL fetch returns empty markdown', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createUrlItem('url-1'))
    fetchKnowledgeWebPageMock.mockResolvedValueOnce('')

    await expect(handler.execute(createCtx({ baseId: 'kb-1', itemId: 'url-1', parentJobId: null }))).rejects.toThrow(
      'empty markdown'
    )

    expect(captureUrlSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('url-1', 'completed')
  })

  it('fails the index when a note has empty/whitespace content', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    const emptyNote = { ...createNoteItem(NOTE_ITEM_ID), data: { source: 'My note', content: '   ' } }
    knowledgeItemGetByIdMock.mockReturnValue(emptyNote)

    await expect(
      handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    ).rejects.toThrow('empty content')

    expect(captureNoteSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('captures a note snapshot on first index, persists its relativePath, and reads it offline', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    // A freshly added / migrated note has no snapshot yet (returned both at load
    // time and at the in-lock re-read); its content is written to a base file.
    const noSnapshotNote = { ...createNoteItem(NOTE_ITEM_ID), data: { source: 'My note', content: 'note body' } }
    knowledgeItemGetByIdMock.mockReturnValue(noSnapshotNote)
    captureNoteSnapshotFileMock.mockResolvedValue('My note.md')

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    // No network fetch; the in-hand content is written and the relativePath persisted.
    expect(fetchKnowledgeWebPageMock).not.toHaveBeenCalled()
    expect(captureNoteSnapshotFileMock).toHaveBeenCalledWith('kb-1', 'My note', 'note body', expect.any(Set))
    expect(knowledgeItemUpdateSnapshotRelativePathMock).toHaveBeenCalledWith(NOTE_ITEM_ID, 'note', 'My note.md')
    // The reader receives the item carrying the freshly captured snapshot path.
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: NOTE_ITEM_ID, data: expect.objectContaining({ relativePath: 'My note.md' }) })
    )
    // The material's relative_path is the real snapshot path under `raw/`, not the
    // item-id virtual placeholder — so it points at the bytes captureNoteSnapshotFile wrote.
    expect(lastRebuildInput().material.relativePath).toBe('My note.md')
  })

  it('does not capture a note that already has a snapshot', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem(NOTE_ITEM_ID, null, 'processing', 'cached-note.md'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(captureNoteSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateSnapshotRelativePathMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relativePath: 'cached-note.md' }) })
    )
  })

  it('skips the note snapshot write when another job captured it first', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    // Load sees no snapshot; the in-lock re-read sees one a concurrent job wrote.
    const noSnapshotNote = { ...createNoteItem(NOTE_ITEM_ID), data: { source: 'My note', content: 'note body' } }
    knowledgeItemGetByIdMock
      .mockReturnValueOnce(noSnapshotNote)
      .mockReturnValueOnce(createNoteItem(NOTE_ITEM_ID, null, 'processing', 'raced-note.md'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(captureNoteSnapshotFileMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateSnapshotRelativePathMock).not.toHaveBeenCalled()
    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relativePath: 'raced-note.md' }) })
    )
    expect(lastRebuildInput().material.relativePath).toBe('raced-note.md')
  })

  it('onSettled skips failed status when the item is deleting', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    )
    knowledgeItemGetByIdMock.mockReturnValue(createNoteItem('note-1', null, 'deleting'))

    await handler.onSettled?.({
      jobId: 'index-job',
      type: 'knowledge.index-documents',
      scheduleId: null,
      parentId: null,
      status: 'failed',
      input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null },
      error: { code: 'FAILED', message: 'cancelled', retryable: false },
      attempt: 1,
      metadata: {}
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', expect.anything())
  })
})
