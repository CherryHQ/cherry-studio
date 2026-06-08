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
import { chunkDocuments } from '../utils/indexing/chunk'
import { embedKnowledgeDocuments } from '../utils/indexing/embed'
import { isIndexableKnowledgeItem } from '../utils/items'
import type { KnowledgeIndexDocumentsPayload } from './jobTypes'
import { isDataApiNotFoundError, markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:IndexDocumentsJobHandler')

type LoadedIndexDocumentsInput = {
  base: KnowledgeBase
  item: IndexableKnowledgeItem
}
type LoadedDocuments = Awaited<ReturnType<typeof loadKnowledgeItemDocuments>>
type ChunkedDocuments = ReturnType<typeof chunkDocuments>
type EmbeddedNodes = Awaited<ReturnType<typeof embedKnowledgeDocuments>>

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
      const chunks = chunkItemDocuments(base, item, documents)

      // Mark embedding separately so the UI reflects the current long-running phase.
      reportKnowledgeProgress(ctx, 40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
      await knowledgeLockManager.withBaseMutationLock(ctx.input.baseId, () =>
        knowledgeItemService.updateStatus(ctx.input.itemId, 'embedding')
      )

      const nodes = await embedItemChunks(ctx, base, chunks)

      // Vector replacement and final status flip must stay atomic at the base mutation level.
      reportKnowledgeProgress(ctx, 80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
      await writeItemVectors(ctx, base, nodes, knowledgeLockManager)

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

function chunkItemDocuments(
  base: KnowledgeBase,
  item: IndexableKnowledgeItem,
  documents: LoadedDocuments
): ChunkedDocuments {
  return chunkDocuments(base, item, documents)
}

async function embedItemChunks(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  chunks: ChunkedDocuments
): Promise<EmbeddedNodes> {
  ctx.signal.throwIfAborted()
  return await embedKnowledgeDocuments(base, chunks, ctx.signal)
}

async function writeItemVectors(
  ctx: JobContext<KnowledgeIndexDocumentsPayload>,
  base: KnowledgeBase,
  nodes: EmbeddedNodes,
  knowledgeLockManager: KnowledgeLockManager
): Promise<void> {
  const { baseId, itemId } = ctx.input

  await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
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
