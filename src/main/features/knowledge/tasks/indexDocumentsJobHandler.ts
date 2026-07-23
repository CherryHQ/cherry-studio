import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { isCompletedVectorKnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId } from '../types'
import type { IndexableKnowledgeItem } from '../types/items'
import { type ChunkedKnowledgeContent, chunkKnowledgeDocuments } from '../utils/indexing/chunk'
import { embedKnowledgeTexts } from '../utils/indexing/embed'
import { refineLocalEmbeddingChunks } from '../utils/indexing/localEmbeddingTokenLimit'
import { toMaterialRelativePath } from '../utils/indexing/materialFields'
import { isIndexableKnowledgeItem } from '../utils/items'
import { captureNoteSnapshotFile } from '../utils/sources/noteSnapshot'
import { fetchKnowledgeWebPage } from '../utils/sources/url'
import { captureUrlSnapshotFile } from '../utils/sources/urlSnapshot'
import { collectKnowledgeReservedRelativePaths } from '../utils/storage/pathStorage'
import { hashEmbeddingText } from '../vectorstore/indexStore/hashing'
import type { RebuildMaterialEmbeddingInput, RebuildMaterialInput } from '../vectorstore/indexStore/model'
import type { KnowledgeIndexDocumentsPayload } from './jobTypes'
import { isDataApiNotFoundError, markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:IndexDocumentsJobHandler')

// Chunks per embedMany call while rebuilding an item's material. Small enough to
// surface incremental progress, large enough to not multiply request overhead.
const EMBEDDING_PROGRESS_BATCH_SIZE = 10
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

export function createIndexDocumentsJobHandler(
  knowledgeLockManager: KnowledgeLockManager
): JobHandler<KnowledgeIndexDocumentsPayload> {
  return {
    // Don't auto-resume on restart — a deliberate app quit must not re-spend the
    // embedding API; the item is parked at `failed` and reindexed on demand.
    recovery: 'abandon',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    defaultRetryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    },
    defaultTimeoutMs: 30 * 60 * 1000,

    async execute(ctx) {
      ctx.signal.throwIfAborted()
      // Validate the target before side effects; missing/deleting items can happen after async delete.
      const input = loadIndexDocumentsInputOrSkip(ctx)
      if (!input) {
        return
      }
      const { base, item } = input

      // Mark reading before file/network IO so the UI reflects the current long-running phase.
      // No base mutation lock: this only writes the main app DB (knowledge_item), not the
      // per-base index.sqlite the lock protects, and updateStatus's own 'deleting' guard
      // (KnowledgeItemService.updateStatus) already covers the race the lock would.
      reportKnowledgeProgress(ctx, 0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
      knowledgeItemService.updateStatus(ctx.input.itemId, 'reading')

      // Capture a url's or note's snapshot on first index (a url fetches outside
      // the lock, a note writes its in-hand content; both persist a relativePath
      // under it), then read every item from disk. Read and chunk outside the base
      // lock; these phases can be slow and do not mutate shared state.
      const readableItem = await ensureSnapshot(ctx, item, knowledgeLockManager)
      const documents = await readItemDocuments(ctx, readableItem)
      const chunked = await chunkItemDocuments(base, documents, ctx.signal)
      if (chunked.chunks.length === 0) {
        // Deliberate: the item still completes (an empty material is written) so the
        // UI doesn't show a stuck/failed item, but leave a trace — an image-only PDF
        // or failed extraction would otherwise look indexed while matching nothing.
        logger.warn('Knowledge item produced no indexable text; it will complete with an empty index', {
          baseId: ctx.input.baseId,
          itemId: ctx.input.itemId,
          jobId: ctx.jobId
        })
      }

      // Mark embedding separately so the UI reflects the current long-running phase.
      // No base mutation lock here either — same reasoning as the 'reading' status above.
      reportKnowledgeProgress(ctx, 40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
      knowledgeItemService.updateStatus(ctx.input.itemId, 'embedding')
      // A prior run's lingering percentage must not flash into this run; the key is
      // recreated only once this run actually embeds chunks (buildRebuildMaterialInput).
      application.get('CacheService').deleteShared(embeddingProgressCacheKey(item.id))

      try {
        // Use readableItem, not item: for a freshly captured url it carries the snapshot
        // relativePath, so the material's relative_path is the real `raw/` snapshot path
        // (matching the migrator) instead of the item-id virtual placeholder.
        const rebuildInput = await buildRebuildMaterialInput(ctx, base, readableItem, chunked)

        // The atomic material rebuild and final status flip must stay together under the base mutation lock.
        reportKnowledgeProgress(ctx, 80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
        await writeItemMaterial(ctx, base, rebuildInput, knowledgeLockManager)

        reportKnowledgeProgress(ctx, 100, { stage: 'done', currentFile: 1, totalFiles: 1 })
      } finally {
        lingerEmbeddingProgress(ctx.input.itemId)
      }
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(event, logger, 'Failed to flip knowledge item to failed in onSettled')
    }
  }
}

function loadIndexDocumentsInputOrSkip(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>
): LoadedIndexDocumentsInput | null {
  const { baseId, itemId } = ctx.input

  try {
    const base = knowledgeBaseService.getById(baseId)
    const item = knowledgeItemService.getById(itemId)

    if (item.status === 'deleting') {
      logger.info('Skipping index-documents for deleting item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'deleting', currentFile: 1, totalFiles: 1 })
      return null
    }

    if (!isIndexableKnowledgeItem(item)) {
      throw new Error(`indexDocumentsJobHandler received non-leaf knowledge item: id=${itemId} type=${item.type}`)
    }

    if (item.status === 'completed') {
      reportKnowledgeProgress(ctx, 100, { stage: 'already-completed', currentFile: 1, totalFiles: 1 })
      return null
    }

    return { base, item }
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      logger.info('Skipping index-documents for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'item-gone', currentFile: 1, totalFiles: 1 })
      return null
    }
    throw error
  }
}

async function readItemDocuments(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  item: IndexableKnowledgeItem
): Promise<LoadedDocuments> {
  ctx.signal.throwIfAborted()
  return await loadKnowledgeItemDocuments(item)
}

type SnapshotCaptureSpec = {
  type: 'url' | 'note'
  /** Produce the snapshot markdown OUTSIDE the base mutation lock; rejects empty input. */
  produce: (signal: AbortSignal) => Promise<string>
  /** Write the produced markdown to a base file under the lock, returning its relativePath. */
  capture: (markdown: string, reservedPaths: Set<string>) => Promise<string>
}

/**
 * Resolve how to capture a url/note snapshot, or null when the item needs none
 * (a file leaf, or a url/note that already has a snapshot). url and note differ
 * only in how the markdown is produced (network fetch vs in-hand content) and
 * written — the lock, re-read, name reservation, and persistence are shared by
 * {@link ensureSnapshot}, so a future cloud source is just another spec.
 */
function resolveSnapshotCaptureSpec(item: IndexableKnowledgeItem): SnapshotCaptureSpec | null {
  if (item.type === 'url' && !item.data.relativePath) {
    const { baseId } = item
    const { url } = item.data
    return {
      type: 'url',
      produce: async (signal) => {
        const markdown = await fetchKnowledgeWebPage(url, signal)
        if (!markdown) {
          throw new Error(`Knowledge URL returned empty markdown: ${url}`)
        }
        return markdown
      },
      capture: (markdown, reservedPaths) => captureUrlSnapshotFile(baseId, url, markdown, reservedPaths)
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
        return content
      },
      capture: (markdown, reservedPaths) => captureNoteSnapshotFile(baseId, source, markdown, reservedPaths)
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
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  item: IndexableKnowledgeItem,
  knowledgeLockManager: KnowledgeLockManager
): Promise<IndexableKnowledgeItem> {
  const spec = resolveSnapshotCaptureSpec(item)
  if (!spec) {
    return item
  }

  const markdown = await spec.produce(ctx.signal)

  return await knowledgeLockManager.withBaseMutationLock(ctx.input.baseId, async () => {
    const latest = knowledgeItemService.getById(ctx.input.itemId)
    if (latest.type !== spec.type || latest.data.relativePath) {
      // Another job captured the snapshot (or the item changed) while we produced.
      return isIndexableKnowledgeItem(latest) ? latest : item
    }
    const reservedPaths = collectKnowledgeReservedRelativePaths(knowledgeItemService.getItemsByBaseId(ctx.input.baseId))
    const relativePath = await spec.capture(markdown, reservedPaths)
    const updated = knowledgeItemService.updateSnapshotRelativePath(ctx.input.itemId, spec.type, relativePath)
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
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  item: IndexableKnowledgeItem,
  chunked: ChunkedKnowledgeContent
): Promise<RebuildMaterialInput> {
  ctx.signal.throwIfAborted()

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
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const existingHashes = await store.listExistingEmbeddingHashes([...bodyByHash.keys()])
    const missing = [...bodyByHash.entries()].filter(([hash]) => !existingHashes.has(hash))

    if (missing.length > 0) {
      const cacheService = application.get('CacheService')
      const progressKey = embeddingProgressCacheKey(item.id)
      // The first write here is what creates the key — earlier paths must not: a
      // BM25-only base or a rebuild whose chunks all reuse stored vectors never
      // embeds anything and must not surface a spurious 0%. No TTL while active;
      // the exit path applies one (see EMBEDDING_PROGRESS_LINGER_TTL_MS).
      cacheService.setShared(progressKey, 0)
      const vectors: number[][] = []
      for (let i = 0; i < missing.length; i += EMBEDDING_PROGRESS_BATCH_SIZE) {
        ctx.signal.throwIfAborted()
        const batch = missing.slice(i, i + EMBEDDING_PROGRESS_BATCH_SIZE)
        const batchVectors = await embedKnowledgeTexts(
          base,
          batch.map(([, body]) => body),
          ctx.signal
        )
        vectors.push(...batchVectors)
        cacheService.setShared(progressKey, Math.round((vectors.length / missing.length) * 100))
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
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  input: RebuildMaterialInput,
  knowledgeLockManager: KnowledgeLockManager
): Promise<void> {
  const { baseId, itemId } = ctx.input

  await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
    ctx.signal.throwIfAborted()
    const latestItem = knowledgeItemService.getById(itemId)
    if (latestItem.status === 'deleting') {
      logger.info('Skipping material rebuild for deleting item', { baseId, itemId, jobId: ctx.jobId })
      return
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    await store.rebuildMaterial(itemId, input)
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
