import { describe, expect, it } from 'vitest'

import { hashEmbeddingText } from '../../vectorstore/indexStore/hashing'
import type { RebuildMaterialInput } from '../../vectorstore/indexStore/model'
import {
  createAbortedCtx,
  createCtx,
  createFileItem,
  createIndexDocumentsJobHandler,
  createJobSnapshot,
  createNoteItem,
  embedKnowledgeTextsMock,
  fakeEmbedVector,
  FILE_ITEM_ID,
  getJobMock,
  knowledgeBaseGetByIdMock,
  knowledgeItemGetByIdMock,
  knowledgeItemUpdateStatusMock,
  knowledgeLockManager,
  listExistingEmbeddingHashesMock,
  loadKnowledgeItemDocumentsMock,
  NOTE_ITEM_ID,
  rebuildMaterialMock
} from './jobHandlerTestUtils'

/** Documents whose single-chunk bodies are exactly these strings (no trimming). */
const DISTINCT_DOCS = ['alpha', 'bravo', 'charlie']

function distinctDocuments() {
  return DISTINCT_DOCS.map((text) => ({ text, metadata: { source: NOTE_ITEM_ID } }))
}

function lastRebuildInput(): RebuildMaterialInput {
  return rebuildMaterialMock.mock.calls[0][1] as RebuildMaterialInput
}

describe('index-documents job handler', () => {
  it('updates statuses, writes vectors, and completes the item', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))

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
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
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
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
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

  it('stamps file-material origin/text_format: a processed Markdown artifact is a processor product', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    const fileItem = createFileItem(FILE_ITEM_ID)
    fileItem.data.indexedRelativePath = 'source.md'
    knowledgeItemGetByIdMock.mockResolvedValue(fileItem)
    knowledgeItemUpdateStatusMock.mockResolvedValue(fileItem)

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: FILE_ITEM_ID, parentJobId: null }))

    const input = lastRebuildInput()
    expect(input.material.origin).toBe('processor')
    expect(input.content.textFormat).toBe('markdown')
  })

  it('stamps a directly-indexed non-Markdown file as user-supplied extracted text', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    const fileItem = createFileItem(FILE_ITEM_ID) // relativePath 'source.pdf', no indexedRelativePath
    knowledgeItemGetByIdMock.mockResolvedValue(fileItem)
    knowledgeItemUpdateStatusMock.mockResolvedValue(fileItem)

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: FILE_ITEM_ID, parentJobId: null }))

    const input = lastRebuildInput()
    expect(input.material.origin).toBe('user')
    expect(input.content.textFormat).toBe('extracted_text')
  })

  it('stamps a note/url material as a captured Markdown snapshot', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    const input = lastRebuildInput()
    expect(input.material.origin).toBe('captured')
    expect(input.content.textFormat).toBe('markdown')
  })

  it('records the indexed file extension on the material, and leaves it unset for virtual-path url/note materials', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)

    const fileItem = createFileItem(FILE_ITEM_ID) // relativePath 'source.pdf'
    knowledgeItemGetByIdMock.mockResolvedValue(fileItem)
    knowledgeItemUpdateStatusMock.mockResolvedValue(fileItem)
    await handler.execute(createCtx({ baseId: 'kb-1', itemId: FILE_ITEM_ID, parentJobId: null }))
    expect(lastRebuildInput().material.fileExt).toBe('.pdf')

    rebuildMaterialMock.mockClear()
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))
    expect(lastRebuildInput().material.fileExt).toBeUndefined()
  })

  it('passes file items to the reader without a fileEntry override', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createFileItem(FILE_ITEM_ID))

    await handler.execute(
      createCtx({
        baseId: 'kb-1',
        itemId: FILE_ITEM_ID,
        parentJobId: null
      })
    )

    expect(loadKnowledgeItemDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: FILE_ITEM_ID }),
      expect.any(AbortSignal)
    )
  })

  it('completes with empty vectors when the reader returns no documents', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
    knowledgeItemUpdateStatusMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
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
      .mockResolvedValueOnce(createNoteItem(NOTE_ITEM_ID))
      .mockResolvedValueOnce(createNoteItem(NOTE_ITEM_ID, null, 'deleting'))

    await handler.execute(createCtx({ baseId: 'kb-1', itemId: NOTE_ITEM_ID, parentJobId: null }))

    expect(rebuildMaterialMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(NOTE_ITEM_ID, 'completed')
  })

  it('does not mark completed when vector replacement fails', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem(NOTE_ITEM_ID))
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

  it('onSettled skips failed status when the item is deleting', async () => {
    const handler = createIndexDocumentsJobHandler(knowledgeLockManager as never)
    getJobMock.mockResolvedValue(
      createJobSnapshot({
        id: 'index-job',
        type: 'knowledge.index-documents',
        input: { baseId: 'kb-1', itemId: 'note-1', parentJobId: null }
      })
    )
    knowledgeItemGetByIdMock.mockResolvedValue(createNoteItem('note-1', null, 'deleting'))

    await handler.onSettled?.({
      jobId: 'index-job',
      type: 'knowledge.index-documents',
      scheduleId: null,
      status: 'failed',
      error: { code: 'FAILED', message: 'cancelled', retryable: false },
      attempt: 1
    })

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith('note-1', 'failed', expect.anything())
  })
})
