import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { DataApiErrorFactory, isDataApiNotFoundError } from '@shared/data/api/errors'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { CompletedKnowledgeBase, KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedKnowledgeBase, isCompletedVectorKnowledgeBase } from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../items'
import { isIndexableKnowledgeItem, toMaterialRelativePath } from '../items'
import { collectKnowledgeReservedRelativePaths } from '../pathStorage'
import { type ChunkedKnowledgeContent, chunkKnowledgeDocuments } from '../pipeline/indexing/chunk'
import { embedKnowledgeTexts } from '../pipeline/indexing/embed'
import { refineLocalEmbeddingChunks } from '../pipeline/indexing/localEmbeddingTokenLimit'
import { loadKnowledgeItemDocuments } from '../pipeline/readers/KnowledgeReader'
import { captureNoteSnapshotFile } from '../pipeline/sources/noteSnapshot'
import { fetchKnowledgeWebPage } from '../pipeline/sources/url'
import { captureUrlSnapshotFile } from '../pipeline/sources/urlSnapshot'
import { hashEmbeddingText } from '../pipeline/vectorstore/indexStore/hashing'
import type { RebuildMaterialEmbeddingInput, RebuildMaterialInput } from '../pipeline/vectorstore/indexStore/model'
import { resolveLiveKnowledgeItem } from '../tasks/utils/liveItem'
import type { KnowledgeProgressDetail } from '../types'

const logger = loggerService.withContext('Knowledge:IndexKnowledgeItem')

// Chunks per embedMany call while rebuilding an item's material. Small enough to
// surface incremental progress, large enough to not multiply request overhead.
const EMBEDDING_PROGRESS_BATCH_SIZE = 10
const EMPTY_INDEXABLE_TEXT_ERROR =
  'No indexable text was extracted. Check the source, OCR, or document processing settings, then reindex.'

/**
 * How long the final percentage lingers after the job exits. The list's item status
 * is polled, so deleting the key at completion time blanks the percentage while the
 * row still shows 'embedding' until the next poll. Active batch writes carry no TTL
 * (a slow batch or material write must not expire the value mid-run); this TTL is
 * applied only on exit, purely as garbage collection after the renderer moved on.
 */
const EMBEDDING_PROGRESS_LINGER_TTL_MS = 60_000

/** Purely in-memory, never persisted — see `knowledge.item.embedding_progress.${itemId}` in cacheSchemas.ts. */
function embeddingProgressCacheKey(itemId: string): `knowledge.item.embedding_progress.${string}` {
  return `knowledge.item.embedding_progress.${itemId}`
}

type LoadedIndexDocumentsInput = {
  base: KnowledgeBase
  item: IndexableKnowledgeItem
}
type LoadedDocuments = Awaited<ReturnType<typeof loadKnowledgeItemDocuments>>

export interface IndexKnowledgeItemInput {
  baseId: string
  itemId: string
  signal: AbortSignal
  reportProgress: (progress: number, detail: KnowledgeProgressDetail) => void
}

export interface PrepareKnowledgeMaterialInput {
  base: CompletedKnowledgeBase
  item: IndexableKnowledgeItem
  signal: AbortSignal
  reportProgress: IndexKnowledgeItemInput['reportProgress']
  /** Reports the transient percentage for actual embedding work, when any is needed. */
  reportEmbeddingProgress?: (progress: number) => void
  /** Looks up reusable embedding hashes without exposing the index store to preparation. */
  listExistingEmbeddingHashes?: (hashes: string[]) => Set<string>
}

export interface PreparedKnowledgeMaterial {
  item: IndexableKnowledgeItem
  rebuildInput: RebuildMaterialInput
}

export type IndexKnowledgeItem = (input: IndexKnowledgeItemInput) => Promise<void>

function assertKnowledgeBaseReadyForPreparation(base: KnowledgeBase): asserts base is CompletedKnowledgeBase {
  if (!isCompletedKnowledgeBase(base)) {
    throw DataApiErrorFactory.invalidOperation(
      'prepareKnowledgeMaterial',
      `Knowledge base '${base.id}' is not ready for material preparation`
    )
  }
}

export function createIndexKnowledgeItem(knowledgeLockManager: KeyedMutex): IndexKnowledgeItem {
  return async (input) => {
    input.signal.throwIfAborted()
    const loaded = loadIndexDocumentsInputOrSkip(input)
    if (!loaded) return
    const { base, item } = loaded
    assertKnowledgeBaseReadyForPreparation(base)

    input.reportProgress(0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
    knowledgeItemService.updateStatus(input.itemId, 'reading')

    const readableItem = await ensureSnapshot(input, item, knowledgeLockManager)
    const listExistingEmbeddingHashes = isCompletedVectorKnowledgeBase(base)
      ? (hashes: string[]) =>
          application.get('KnowledgeVectorStoreService').getIndexStore(base).listExistingEmbeddingHashes(hashes)
      : undefined
    let embeddingStarted = false
    try {
      const { rebuildInput } = await prepareKnowledgeMaterial({
        base,
        item: readableItem,
        signal: input.signal,
        reportProgress: (progress, detail) => {
          input.reportProgress(progress, detail)
          knowledgeItemService.updateStatus(input.itemId, 'embedding')
          application.get('CacheService').deleteShared(embeddingProgressCacheKey(item.id))
          embeddingStarted = true
        },
        reportEmbeddingProgress: (progress) =>
          application.get('CacheService').setShared(embeddingProgressCacheKey(item.id), progress),
        listExistingEmbeddingHashes
      })
      input.reportProgress(80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
      await writeItemMaterial(input, base, rebuildInput, knowledgeLockManager)
      input.reportProgress(100, { stage: 'done', currentFile: 1, totalFiles: 1 })
    } finally {
      if (embeddingStarted) {
        lingerEmbeddingProgress(input.itemId)
      }
    }
  }
}

export async function prepareKnowledgeMaterial(
  input: PrepareKnowledgeMaterialInput
): Promise<PreparedKnowledgeMaterial> {
  input.signal.throwIfAborted()
  assertKnowledgeBaseReadyForPreparation(input.base)
  toMaterialRelativePath(input.item)
  const documents = await readItemDocuments(input.signal, input.item)
  const chunked = await chunkItemDocuments(input.base, documents, input.signal)
  if (chunked.chunks.length === 0) {
    logger.warn('Knowledge item produced no indexable text; failing indexing', {
      baseId: input.base.id,
      itemId: input.item.id
    })
    throw new Error(EMPTY_INDEXABLE_TEXT_ERROR)
  }

  input.reportProgress(40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
  const rebuildInput = await buildRebuildMaterialInput(input, input.base, input.item, chunked)
  return { item: input.item, rebuildInput }
}

function loadIndexDocumentsInputOrSkip(input: IndexKnowledgeItemInput): LoadedIndexDocumentsInput | null {
  const { baseId, itemId } = input

  let base: KnowledgeBase
  try {
    base = knowledgeBaseService.getById(baseId)
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      logger.info('Skipping index-documents for missing base or item', { baseId, itemId })
      input.reportProgress(100, { stage: 'item-gone', currentFile: 1, totalFiles: 1 })
      return null
    }
    throw error
  }

  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping index-documents for deleting item', { baseId, itemId })
      input.reportProgress(100, { stage: 'deleting', currentFile: 1, totalFiles: 1 })
    } else {
      logger.info('Skipping index-documents for missing base or item', { baseId, itemId })
      input.reportProgress(100, { stage: 'item-gone', currentFile: 1, totalFiles: 1 })
    }
    return null
  }
  const { item } = result

  if (!isIndexableKnowledgeItem(item)) {
    throw new Error(`indexKnowledgeItem received non-leaf knowledge item: id=${itemId} type=${item.type}`)
  }

  if (item.status === 'completed') {
    input.reportProgress(100, { stage: 'already-completed', currentFile: 1, totalFiles: 1 })
    return null
  }

  return { base, item }
}

async function readItemDocuments(signal: AbortSignal, item: IndexableKnowledgeItem): Promise<LoadedDocuments> {
  signal.throwIfAborted()
  return await loadKnowledgeItemDocuments(item)
}

type SnapshotCaptureSpec = {
  type: 'url' | 'note'
  /** Produce snapshot content OUTSIDE the base mutation lock; rejects empty input. */
  produce: (signal: AbortSignal) => Promise<{ markdown: string; title?: string }>
  /** Write the produced snapshot to a base file under the lock, returning its relativePath. */
  capture: (snapshot: { markdown: string; title?: string }, reservedPaths: Set<string>) => Promise<string>
}

/**
 * Resolve how to capture a url/note snapshot, or null when the item needs none
 * (a file leaf, or a url/note that already has a snapshot). url and note differ
 * only in how the markdown is produced (network fetch vs in-hand content) and
 * written — the lock, re-read, name reservation, and persistence are shared by
 * {@link ensureSnapshot}. External sources arrive with an already-pinned snapshot
 * and intentionally bypass this capture path.
 */
function resolveSnapshotCaptureSpec(item: IndexableKnowledgeItem): SnapshotCaptureSpec | null {
  if (item.type === 'url' && !item.data.relativePath) {
    const { baseId } = item
    const { url } = item.data
    return {
      type: 'url',
      produce: async (signal) => {
        const page = await fetchKnowledgeWebPage(url, signal)
        if (!page.markdown) {
          throw new Error(`Knowledge URL returned empty markdown: ${url}`)
        }
        return page
      },
      capture: ({ markdown, title }, reservedPaths) =>
        captureUrlSnapshotFile(baseId, url, markdown, reservedPaths, title)
    }
  }

  if (item.type === 'note' && !item.data.relativePath) {
    const { baseId } = item
    const { source, content } = item.data
    return {
      type: 'note',
      // The content is already in hand, so there is no network step — but still
      // reject empty/whitespace-only content here (before the lock, like the url
      // empty-markdown guard): an empty note would otherwise write a
      // frontmatter-only snapshot and complete with an empty index.
      produce: async () => {
        if (content.trim() === '') {
          throw new Error(`Knowledge note has empty content: ${source}`)
        }
        return { markdown: content }
      },
      capture: ({ markdown }, reservedPaths) => captureNoteSnapshotFile(baseId, source, markdown, reservedPaths)
    }
  }

  return null
}

/**
 * Ensure a url or note item has an on-disk snapshot before it is read. An item
 * without a `relativePath` (freshly added or migrated from v1) is captured once
 * here: its markdown is produced outside the base mutation lock (a url fetches
 * over the network, a note returns its in-hand content), then the name
 * allocation, file write, and `relativePath` persistence run under the lock so
 * concurrent captures in the same base cannot pick the same path. file items, and
 * url/note items that already have a snapshot, pass straight through.
 */
async function ensureSnapshot(
  input: IndexKnowledgeItemInput,
  item: IndexableKnowledgeItem,
  knowledgeLockManager: KeyedMutex
): Promise<IndexableKnowledgeItem> {
  const spec = resolveSnapshotCaptureSpec(item)
  if (!spec) {
    return item
  }

  const snapshot = await spec.produce(input.signal)

  return await knowledgeLockManager.runExclusive(input.baseId, async () => {
    const latest = knowledgeItemService.getById(input.itemId)
    if (latest.type !== spec.type || latest.data.relativePath) {
      // Another job captured the snapshot (or the item changed) while we produced.
      return isIndexableKnowledgeItem(latest) ? latest : item
    }
    const reservedPaths = collectKnowledgeReservedRelativePaths(knowledgeItemService.getItemsByBaseId(input.baseId))
    const relativePath = await spec.capture(snapshot, reservedPaths)
    const updated = knowledgeItemService.updateSnapshotRelativePath(input.itemId, spec.type, relativePath)
    return isIndexableKnowledgeItem(updated) ? updated : item
  })
}

async function chunkItemDocuments(
  base: KnowledgeBase,
  documents: LoadedDocuments,
  signal: AbortSignal
): Promise<ChunkedKnowledgeContent> {
  const chunked = chunkKnowledgeDocuments(base, documents)
  if (base.embeddingModelId !== LOCAL_EMBEDDING_UNIQUE_MODEL_ID || chunked.chunks.length === 0) {
    return chunked
  }

  return await refineLocalEmbeddingChunks(base, chunked, signal)
}

/**
 * Embed the distinct chunk bodies and assemble the atomic rebuild input. Bodies
 * are deduped by embedding-text hash so identical chunks are embedded once; the
 * store keys embeddings by that same hash, so every unit resolves its vector.
 */
async function buildRebuildMaterialInput(
  input: PrepareKnowledgeMaterialInput,
  base: KnowledgeBase,
  item: IndexableKnowledgeItem,
  chunked: ChunkedKnowledgeContent
): Promise<RebuildMaterialInput> {
  input.signal.throwIfAborted()

  const bodyByHash = new Map<string, string>()
  for (const chunk of chunked.chunks) {
    bodyByHash.set(hashEmbeddingText(chunk.text), chunk.text)
  }

  // A BM25-only base (no embedding model) indexes lexically: store the FTS text
  // and skip embedding entirely. A vector base embeds only the chunk bodies the
  // index does not already have (decision A4: reuse vectors stored for unchanged
  // chunks so reindexing does not re-spend the paid embedding API; existing hashes
  // resolve to their stored vector at query time and rebuildMaterial keeps them).
  const usesEmbeddings = isCompletedVectorKnowledgeBase(base)
  let embeddings: RebuildMaterialEmbeddingInput[] = []
  if (usesEmbeddings) {
    const existingHashes = input.listExistingEmbeddingHashes?.([...bodyByHash.keys()]) ?? new Set<string>()
    const missing = [...bodyByHash.entries()].filter(([hash]) => !existingHashes.has(hash))

    if (missing.length > 0) {
      // The first report here is what creates transient progress for the live-job
      // caller. A BM25-only or fully reused rebuild never reports a spurious 0%.
      input.reportEmbeddingProgress?.(0)
      const vectors: number[][] = []
      for (let i = 0; i < missing.length; i += EMBEDDING_PROGRESS_BATCH_SIZE) {
        input.signal.throwIfAborted()
        const batch = missing.slice(i, i + EMBEDDING_PROGRESS_BATCH_SIZE)
        const batchVectors = await embedKnowledgeTexts(
          base,
          batch.map(([, body]) => body),
          input.signal
        )
        input.signal.throwIfAborted()
        vectors.push(...batchVectors)
        input.reportEmbeddingProgress?.(Math.round((vectors.length / missing.length) * 100))
      }

      embeddings = missing.map(([embeddingTextHash], index) => ({ embeddingTextHash, vector: vectors[index] }))
    }
  }

  return {
    material: {
      relativePath: toMaterialRelativePath(item)
    },
    content: {
      text: chunked.contentText
    },
    units: chunked.chunks.map((chunk) => ({
      unitType: 'chunk',
      unitIndex: chunk.unitIndex,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd
    })),
    usesEmbeddings,
    embeddings
  }
}

async function writeItemMaterial(
  operationInput: IndexKnowledgeItemInput,
  base: KnowledgeBase,
  input: RebuildMaterialInput,
  knowledgeLockManager: KeyedMutex
): Promise<void> {
  const { baseId, itemId } = operationInput

  await knowledgeLockManager.runExclusive(baseId, async () => {
    operationInput.signal.throwIfAborted()
    const result = resolveLiveKnowledgeItem(itemId)
    if ('skip' in result) {
      logger.info('Skipping material rebuild for deleting item', { baseId, itemId })
      return
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = vectorStoreService.getIndexStore(base)
    store.rebuildMaterial(itemId, input)
    knowledgeItemService.updateStatus(itemId, 'completed')
  })
}

/**
 * Converts the item's in-flight progress entry (if any) into a TTL'd leftover
 * instead of deleting it. The renderer learns the item's status by polling, so an
 * immediate delete blanks the percentage while the row still reads 'embedding';
 * keeping the last value until the poll observes the terminal status closes that
 * gap on every exit path (completed, failed, aborted), and the TTL then collects
 * the entry once nothing renders it anymore.
 */
function lingerEmbeddingProgress(itemId: string): void {
  const cacheService = application.get('CacheService')
  const progressKey = embeddingProgressCacheKey(itemId)
  const current = cacheService.getShared(progressKey)
  if (current === undefined) {
    return
  }
  // A same-value write with a new TTL still reaches renderer mirrors (setShared
  // broadcasts TTL-only changes with the absolute expiry), and the main-side GC
  // broadcasts the eventual expiry deletion, so a single write is enough.
  cacheService.setShared(progressKey, current, EMBEDDING_PROGRESS_LINGER_TTL_MS)
}
