// Side-effect import picks up the declare-module merges for the knowledge job
// registry so the JobHandler<…> generic below resolves the payload type.
import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { chunkDocuments } from '../utils/chunk'
import { embedDocuments } from '../utils/embed'
import { isIndexableKnowledgeItem } from '../utils/items'
import { getEmbedModel } from '../utils/model'
import type { KnowledgeIndexLeafPayload } from './jobTypes'

const logger = loggerService.withContext('indexLeafJobHandler')
const KNOWLEDGE_EMPTY_CONTENT_REASON = 'KNOWLEDGE_EMPTY_CONTENT'

function assertHasIndexableContent<T>(items: T[]): void {
  if (items.length === 0) {
    throw new Error(KNOWLEDGE_EMPTY_CONTENT_REASON)
  }
}

export const indexLeafJobHandler: JobHandler<KnowledgeIndexLeafPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `base.${input.baseId}`,
  defaultConcurrency: 5,
  defaultRetryPolicy: {
    maxAttempts: 3,
    backoff: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 30_000
  },
  defaultTimeoutMs: 5 * 60 * 1000,

  async execute(ctx) {
    const { baseId, itemId } = ctx.input
    const runtime = application.get('KnowledgeRuntimeService')
    const vectorStoreService = application.get('KnowledgeVectorStoreService')

    ctx.signal.throwIfAborted()
    const base = await knowledgeBaseService.getById(baseId)
    const item = await knowledgeItemService.getById(itemId)

    if (!isIndexableKnowledgeItem(item)) {
      throw new Error(`indexLeafJobHandler received non-leaf knowledge item: id=${itemId} type=${item.type}`)
    }

    // Idempotent crash-retry optimization: if a previous attempt successfully
    // wrote vectors and marked the item completed but the jobTable row was not
    // finalized before crash, skip the embed cycle. The atomic
    // `replaceByExternalId` below would otherwise idempotently overwrite the
    // same chunks — correct but wasteful (embedding tokens cost real money).
    if (item.status === 'completed') {
      logger.info('Skipping index-leaf for already-completed item', { baseId, itemId, jobId: ctx.jobId })
      ctx.reportProgress(100, { stage: 'already-completed', currentFile: 1, totalFiles: 1 })
      return
    }

    ctx.reportProgress(0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
    await runtime.runWithBaseWriteLockForBase(baseId, () =>
      knowledgeItemService.updateStatus(itemId, 'processing', { phase: 'reading' })
    )

    ctx.signal.throwIfAborted()
    const documents = await loadKnowledgeItemDocuments(item, ctx.signal)
    assertHasIndexableContent(documents)

    ctx.signal.throwIfAborted()
    const chunks = chunkDocuments(base, item, documents)
    assertHasIndexableContent(chunks)

    ctx.reportProgress(40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
    await runtime.runWithBaseWriteLockForBase(baseId, () =>
      knowledgeItemService.updateStatus(itemId, 'processing', { phase: 'embedding' })
    )

    ctx.signal.throwIfAborted()
    const embedModel = getEmbedModel(base)
    const nodes = await embedDocuments(embedModel, chunks, ctx.signal)

    ctx.reportProgress(80, { stage: 'writing', currentFile: 0, totalFiles: 1 })

    // Atomic delete-then-insert inside a single libSQL transaction. Crash-retry
    // therefore never leaves orphan chunks (the prior chunk set is wiped in the
    // same transaction that writes the new one) AND never loses chunks on
    // insert failure (transaction rolls back, old chunks remain).
    await runtime.runWithBaseWriteLockForBase(baseId, async () => {
      ctx.signal.throwIfAborted()
      const vectorStore = await vectorStoreService.createStore(base)
      await vectorStore.replaceByExternalId(itemId, nodes)
      await knowledgeItemService.updateStatus(itemId, 'completed')
    })

    ctx.reportProgress(100, { stage: 'done', currentFile: 1, totalFiles: 1 })
  }
}
