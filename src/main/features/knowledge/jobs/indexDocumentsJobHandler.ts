import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId } from '../types'
import type { IndexableKnowledgeItem } from '../types/items'
import { type ChunkedKnowledgeContent, chunkKnowledgeDocuments } from '../utils/indexing/chunk'
import { embedKnowledgeTexts } from '../utils/indexing/embed'
import { toMaterialRelativePath } from '../utils/indexing/materialFields'
import { isIndexableKnowledgeItem } from '../utils/items'
import { captureNoteSnapshotFile } from '../utils/sources/noteSnapshot'
import { fetchKnowledgeWebPage } from '../utils/sources/url'
import { captureUrlSnapshotFile } from '../utils/sources/urlSnapshot'
import { collectKnowledgeReservedRelativePaths } from '../utils/storage/pathStorage'
import { hashEmbeddingText } from '../vectorstore/indexStore/hashing'
import type { RebuildMaterialInput } from '../vectorstore/indexStore/model'
import type { KnowledgeIndexDocumentsPayload } from './jobTypes'
import { isDataApiNotFoundError, markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:IndexDocumentsJobHandler')

type LoadedIndexDocumentsInput = {
  base: KnowledgeBase
  item: IndexableKnowledgeItem
}
type LoadedDocuments = Awaited<ReturnType<typeof loadKnowledgeItemDocuments>>

export function createIndexDocumentsJobHandler(
  knowledgeLockManager: KnowledgeLockManager
): JobHandler<KnowledgeIndexDocumentsPayload> {
  return {
    recovery: 'retry',
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
      const input = await loadIndexDocumentsInputOrSkip(ctx)
      if (!input) {
        return
      }
      const { base, item } = input

      // Mark reading before file/network IO so the UI reflects the current long-running phase.
      reportKnowledgeProgress(ctx, 0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
      await knowledgeLockManager.withBaseMutationLock(ctx.input.baseId, async () => {
        await knowledgeItemService.updateStatus(ctx.input.itemId, 'reading')
      })

      // Capture a url's or note's snapshot on first index (a url fetches outside
      // the lock, a note writes its in-hand content; both persist a relativePath
      // under it), then read every item from disk. Read and chunk outside the base
      // lock; these phases can be slow and do not mutate shared state.
      const readableItem = await ensureSnapshot(ctx, item, knowledgeLockManager)
      const documents = await readItemDocuments(ctx, readableItem)
      const chunked = chunkItemDocuments(base, documents)
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
      reportKnowledgeProgress(ctx, 40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
      await knowledgeLockManager.withBaseMutationLock(ctx.input.baseId, () =>
        knowledgeItemService.updateStatus(ctx.input.itemId, 'embedding')
      )

      // Use readableItem, not item: for a freshly captured url it carries the snapshot
      // relativePath, so the material's relative_path is the real `raw/` snapshot path
      // (matching the migrator) instead of the item-id virtual placeholder.
      const rebuildInput = await buildRebuildMaterialInput(ctx, base, readableItem, chunked)

      // The atomic material rebuild and final status flip must stay together under the base mutation lock.
      reportKnowledgeProgress(ctx, 80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
      await writeItemMaterial(ctx, base, rebuildInput, knowledgeLockManager)

      reportKnowledgeProgress(ctx, 100, { stage: 'done', currentFile: 1, totalFiles: 1 })
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(event, logger, 'Failed to flip knowledge item to failed in onSettled')
    }
  }
}

async function loadIndexDocumentsInputOrSkip(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>
): Promise<LoadedIndexDocumentsInput | null> {
  const { baseId, itemId } = ctx.input

  try {
    const base = await knowledgeBaseService.getById(baseId)
    const item = await knowledgeItemService.getById(itemId)

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
    const latest = await knowledgeItemService.getById(ctx.input.itemId)
    if (latest.type !== spec.type || latest.data.relativePath) {
      // Another job captured the snapshot (or the item changed) while we produced.
      return isIndexableKnowledgeItem(latest) ? latest : item
    }
    const reservedPaths = collectKnowledgeReservedRelativePaths(
      await knowledgeItemService.getItemsByBaseId(ctx.input.baseId)
    )
    const relativePath = await spec.capture(markdown, reservedPaths)
    const updated = await knowledgeItemService.updateSnapshotRelativePath(ctx.input.itemId, spec.type, relativePath)
    return isIndexableKnowledgeItem(updated) ? updated : item
  })
}

function chunkItemDocuments(base: KnowledgeBase, documents: LoadedDocuments): ChunkedKnowledgeContent {
  return chunkKnowledgeDocuments(base, documents)
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

  // Decision A4: reuse vectors already stored for unchanged chunks — only embed
  // the hashes the index does not have yet, so reindexing unchanged content does
  // not re-spend the paid embedding API. Existing hashes resolve to their stored
  // vector at query time; rebuildMaterial keeps them.
  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const store = await vectorStoreService.getIndexStore(base)
  const existingHashes = await store.listExistingEmbeddingHashes([...bodyByHash.keys()])
  const missing = [...bodyByHash.entries()].filter(([hash]) => !existingHashes.has(hash))
  const vectors = await embedKnowledgeTexts(
    base,
    missing.map(([, body]) => body),
    ctx.signal
  )

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
    embeddings: missing.map(([embeddingTextHash], index) => ({ embeddingTextHash, vector: vectors[index] }))
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
    const latestItem = await knowledgeItemService.getById(itemId)
    if (latestItem.status === 'deleting') {
      logger.info('Skipping material rebuild for deleting item', { baseId, itemId, jobId: ctx.jobId })
      return
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    await store.rebuildMaterial(itemId, input)
    await knowledgeItemService.updateStatus(itemId, 'completed')
  })
}
