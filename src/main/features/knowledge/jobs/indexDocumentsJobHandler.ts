import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { getFileExt } from '@main/utils/file'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId } from '../types'
import type { IndexableKnowledgeItem } from '../types/items'
import { type ChunkedKnowledgeContent, chunkKnowledgeDocuments } from '../utils/indexing/chunk'
import { embedKnowledgeTexts } from '../utils/indexing/embed'
import { isIndexableKnowledgeItem } from '../utils/items'
import { hashEmbeddingText } from '../vectorstore/indexStore/hashing'
import type { ContentTextFormat, MaterialOrigin, RebuildMaterialInput } from '../vectorstore/indexStore/model'
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

      // Read and chunk outside the base lock; these phases can be slow and do not mutate shared state.
      const documents = await readItemDocuments(ctx, item)
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

      const rebuildInput = await buildRebuildMaterialInput(ctx, base, item, chunked)

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
  return await loadKnowledgeItemDocuments(item, ctx.signal)
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
      relativePath: toMaterialRelativePath(item),
      origin: toMaterialOrigin(item),
      indexPolicy: 'index',
      fileExt: toMaterialFileExt(item)
      // title / mimeType / sizeBytes / mtimeMs are deliberately left unset here.
      // A knowledge_item has no display name, and the rest need an extra fs.stat +
      // content-type sniff — and nothing consumes any of them yet (provenance
      // display is v2.x). The material scanner backfills them when it lands. See
      // knowledge-technical-design.md §4.2.
    },
    content: {
      text: chunked.contentText,
      textFormat: toContentTextFormat(item),
      normalizationVersion: 1
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

/** A material's stable relative path: the file's path for files, else the item id (notes/URLs have no file). */
function toMaterialRelativePath(item: IndexableKnowledgeItem): string {
  if (item.type === 'file') {
    return item.data.indexedRelativePath ?? item.data.relativePath
  }
  return item.id
}

/**
 * Material provenance (the index store's `origin` enum). A file indexed through a
 * processor artifact — MinerU Markdown, addressed by `indexedRelativePath` — is a
 * 'processor' product; a file indexed directly is user-supplied; url/note are
 * 'captured' snapshots. See knowledge-technical-design.md §4.2.
 */
function toMaterialOrigin(item: IndexableKnowledgeItem): MaterialOrigin {
  if (item.type !== 'file') {
    return 'captured'
  }
  return item.data.indexedRelativePath ? 'processor' : 'user'
}

/**
 * Format of the content that is actually indexed. The reader resolves a file to
 * `indexedRelativePath ?? relativePath`, so a `.md` there (a processor's Markdown
 * output or a Markdown upload) is 'markdown'; any other file is reader-extracted
 * text; url/note snapshots are Markdown.
 */
function toContentTextFormat(item: IndexableKnowledgeItem): ContentTextFormat {
  if (item.type !== 'file') {
    return 'markdown'
  }
  const indexedPath = item.data.indexedRelativePath ?? item.data.relativePath
  return getFileExt(indexedPath).toLowerCase() === '.md' ? 'markdown' : 'extracted_text'
}

/**
 * Lower-cased extension of the indexed file (including the dot, e.g. `.pdf`), or
 * undefined for url/note materials whose relative path is a virtual id, not a file.
 */
function toMaterialFileExt(item: IndexableKnowledgeItem): string | undefined {
  if (item.type !== 'file') {
    return undefined
  }
  const indexedPath = item.data.indexedRelativePath ?? item.data.relativePath
  return getFileExt(indexedPath).toLowerCase() || undefined
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
