import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator'
import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { knowledgeQueueName } from '../types'
import type { IndexableKnowledgeItem } from '../types/items'
import { chunkDocuments } from '../utils/indexing/chunk'
import { embedDocuments } from '../utils/indexing/embed'
import { isIndexableKnowledgeItem } from '../utils/items'
import { getEmbedModel } from '../utils/model/embedding'
import type { KnowledgeIndexDocumentsPayload } from './jobTypes'

const logger = loggerService.withContext('Knowledge:IndexDocumentsJobHandler')
const KNOWLEDGE_EMPTY_CONTENT_REASON = 'KNOWLEDGE_EMPTY_CONTENT'

type LoadedIndexDocumentsInput = {
  base: KnowledgeBase
  item: IndexableKnowledgeItem
}
type LoadedDocuments = Awaited<ReturnType<typeof loadKnowledgeItemDocuments>>
type ChunkedDocuments = ReturnType<typeof chunkDocuments>
type EmbeddedNodes = Awaited<ReturnType<typeof embedDocuments>>

function assertHasIndexableContent<T>(items: T[]): void {
  if (items.length === 0) {
    throw new Error(KNOWLEDGE_EMPTY_CONTENT_REASON)
  }
}

export function createIndexDocumentsJobHandler(
  mutationCoordinator: KnowledgeMutationCoordinator
): JobHandler<KnowledgeIndexDocumentsPayload> {
  return {
    recovery: 'retry',
    defaultQueue: (input) => knowledgeQueueName(input.baseId),
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
      ctx.reportProgress(0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
      await updateItemStatus(ctx, mutationCoordinator, 'reading')

      // Read and chunk outside the base lock; these phases can be slow and do not mutate shared state.
      const documents = await readItemDocuments(ctx, item)
      const chunks = chunkItemDocuments(base, item, documents)

      // Mark embedding separately so a retry can report where the previous attempt stopped.
      ctx.reportProgress(40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
      await updateItemStatus(ctx, mutationCoordinator, 'embedding')

      const nodes = await embedItemChunks(ctx, base, chunks)

      // Vector replacement and final status flip must stay atomic at the base mutation level.
      ctx.reportProgress(80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
      await writeItemVectors(ctx, base, nodes, mutationCoordinator)

      ctx.reportProgress(100, { stage: 'done', currentFile: 1, totalFiles: 1 })
    },

    async onSettled(event) {
      if (event.status === 'completed') return

      const jobManager = application.get('JobManager')
      const snapshot = await jobManager.get(event.jobId)
      const input = snapshot?.input as { itemId?: string } | undefined
      if (!input?.itemId) return

      const reason = event.error?.message?.trim() || `Job ${event.status}`
      try {
        const item = await knowledgeItemService.getById(input.itemId)
        if (item.status === 'deleting') return

        await knowledgeItemService.updateStatus(input.itemId, 'failed', { error: reason })
      } catch (error) {
        if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return
        logger.error(
          'Failed to flip knowledge item to failed in onSettled',
          error instanceof Error ? error : new Error(String(error)),
          { jobId: event.jobId, itemId: input.itemId }
        )
      }
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
      ctx.reportProgress(100, { stage: 'deleting', currentFile: 1, totalFiles: 1 })
      return null
    }

    if (!isIndexableKnowledgeItem(item)) {
      throw new Error(`indexDocumentsJobHandler received non-leaf knowledge item: id=${itemId} type=${item.type}`)
    }

    if (item.status === 'completed') {
      ctx.reportProgress(100, { stage: 'already-completed', currentFile: 1, totalFiles: 1 })
      return null
    }

    return { base, item }
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      logger.info('Skipping index-documents for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      ctx.reportProgress(100, { stage: 'item-gone', currentFile: 1, totalFiles: 1 })
      return null
    }
    throw error
  }
}

async function updateItemStatus(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  mutationCoordinator: KnowledgeMutationCoordinator,
  status: 'reading' | 'embedding'
): Promise<void> {
  const { baseId, itemId } = ctx.input

  await mutationCoordinator.withBaseMutationLock(baseId, () => knowledgeItemService.updateStatus(itemId, status))
}

async function readItemDocuments(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  item: IndexableKnowledgeItem
): Promise<LoadedDocuments> {
  ctx.signal.throwIfAborted()
  const documents = await loadKnowledgeItemDocuments(item, ctx.signal)
  assertHasIndexableContent(documents)
  return documents
}

function chunkItemDocuments(
  base: KnowledgeBase,
  item: IndexableKnowledgeItem,
  documents: LoadedDocuments
): ChunkedDocuments {
  const chunks = chunkDocuments(base, item, documents)
  assertHasIndexableContent(chunks)
  return chunks
}

async function embedItemChunks(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  chunks: ChunkedDocuments
): Promise<EmbeddedNodes> {
  ctx.signal.throwIfAborted()
  return await embedDocuments(getEmbedModel(base), chunks, ctx.signal)
}

async function writeItemVectors(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  nodes: EmbeddedNodes,
  mutationCoordinator: KnowledgeMutationCoordinator
): Promise<void> {
  const { baseId, itemId } = ctx.input

  await mutationCoordinator.withBaseMutationLock(baseId, async () => {
    ctx.signal.throwIfAborted()
    const latestItem = await knowledgeItemService.getById(itemId)
    if (latestItem.status === 'deleting') {
      logger.info('Skipping vector write for deleting item', { baseId, itemId, jobId: ctx.jobId })
      return
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    await vectorStore.replaceByExternalId(itemId, nodes)
    await knowledgeItemService.updateStatus(itemId, 'completed')
  })
}
