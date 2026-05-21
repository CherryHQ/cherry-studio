import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  KnowledgeChunkMetadataSchema,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeRuntimeAddItemInput,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { rerankKnowledgeSearchResults } from '../rerank/rerank'
import { indexLeafJobHandler } from '../tasks/indexLeafJobHandler'
import { prepareRootJobHandler } from '../tasks/prepareRootJobHandler'
import { filterIndexableKnowledgeItems, isContainerKnowledgeItem } from '../utils/items'
import { getEmbedModel } from '../utils/model'
import { mapChunkDocument } from './utils/chunks'
import { deleteItemVectors } from './utils/cleanup'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './utils/search'

const logger = loggerService.withContext('KnowledgeRuntimeService')

const ACTIVE_STATUSES = ['pending', 'delayed', 'running'] as const
const ACTIVE_JOB_LIMIT = 5000
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 35_000
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/u

type JobInputWithItem = { itemId?: string } | null

@Injectable('KnowledgeRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService'])
export class KnowledgeRuntimeService extends BaseService {
  /**
   * Layer 3 business mutex per knowledge base. Promise-chain serialization
   * keeps vector-store writes and DB status flips together across all handler
   * instances, including instances created after crash + retry.
   *
   * @internal Handlers reach this only via runWithBaseWriteLockForBase().
   */
  private readonly baseWriteLocks = new Map<string, Promise<void>>()

  protected onInit(): void {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('knowledge.prepare-root', prepareRootJobHandler)
    jobManager.registerHandler('knowledge.index-leaf', indexLeafJobHandler)
  }

  protected async onStop(): Promise<void> {
    const jobManager = application.get('JobManager')
    await Promise.allSettled([
      jobManager.cancelMany({ type: 'knowledge.prepare-root' }, 'service-shutdown'),
      jobManager.cancelMany({ type: 'knowledge.index-leaf' }, 'service-shutdown')
    ])
    // Cap the drain wait so a wedged handler cannot block process exit beyond
    // the outer Application shutdown timeout (5s). Stragglers past this point
    // are recovered on next startup.
    await this.waitForBaseWriteLocks(undefined, DEFAULT_LOCK_WAIT_TIMEOUT_MS)
    // Intentionally no item.status rollback. Items left in 'processing' here
    // are recovered after restart: JobManager.onAllReady's startup-recovery
    // flips their jobs back to 'pending' and the handler re-runs. The handler
    // early-returns when item.status is already 'completed', so the only
    // observable cost is the brief window where item.status lingers as
    // 'processing' between shutdown and next startup recovery.
  }

  async createBase(baseId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.createStore(base)
  }

  async deleteBaseArtifacts(baseId: string): Promise<void> {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.deleteStore(baseId)
  }

  async cancelAllJobsForBase(baseId: string): Promise<void> {
    const jobManager = application.get('JobManager')
    await jobManager.cancelMany({ queue: `base.${baseId}` }, 'delete-base')
  }

  async addItems(baseId: string, inputs: KnowledgeRuntimeAddItemInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    const base = await knowledgeBaseService.getById(baseId)
    const acceptedItems: KnowledgeItem[] = []

    // Hold the Layer 3 lock across create + status + enqueue so a concurrent
    // reindexItems cannot interleave its list-and-cancel pass partway through.
    await this.runWithBaseWriteLockForBase(base.id, async () => {
      try {
        for (const input of inputs) {
          const createdItem = await knowledgeItemService.create(base.id, input)
          acceptedItems.push(createdItem)
          acceptedItems[acceptedItems.length - 1] = isContainerKnowledgeItem(createdItem)
            ? await knowledgeItemService.updateStatus(createdItem.id, 'processing', { phase: 'preparing' })
            : await knowledgeItemService.updateStatus(createdItem.id, 'processing')
        }
        for (const item of acceptedItems) {
          await this.enqueueRootItem(item)
        }
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to add knowledge items', normalizedError, {
          baseId: base.id,
          accepted: acceptedItems.length,
          total: inputs.length
        })
        await this.deleteAcceptedItemsBestEffort(acceptedItems, normalizedError, base.id)
        throw error
      }
    })
  }

  async reindexItems(baseId: string, rootItems: KnowledgeItem[]): Promise<void> {
    const jobManager = application.get('JobManager')
    const base = await knowledgeBaseService.getById(baseId)
    const rootIds = [...new Set(rootItems.map((item) => item.id))]

    // Phase 1 (locked): identify active jobs whose itemId falls inside our
    // subtree. Without the lock a concurrent addItems could land between list
    // and cancel, smuggling new jobs past our cleanup.
    let jobIdsToCancel: string[] = []
    await this.runWithBaseWriteLockForBase(baseId, async () => {
      const allItems = await knowledgeItemService.getDescendantAndSelfItems(baseId, rootIds)
      const allItemIds = new Set(allItems.map((item) => item.id))
      const activeJobs = await jobManager.list({
        queue: `base.${baseId}`,
        status: [...ACTIVE_STATUSES],
        limit: ACTIVE_JOB_LIMIT
      })
      jobIdsToCancel = activeJobs
        .filter((job) => allItemIds.has((job.input as JobInputWithItem)?.itemId ?? ''))
        .map((job) => job.id)
    })

    // Phase 2 (unlocked): JobManager.cancel waits up to cancelTimeoutMs per
    // in-flight job for the handler to react. Cancelling in parallel bounds
    // total wait by the slowest single handler, not the sum across all.
    await Promise.all(
      jobIdsToCancel.map((jobId) =>
        jobManager.cancel(jobId, 'reindex').catch((error) => {
          logger.warn('reindex cancel failed (job may already be terminal)', {
            jobId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      )
    )

    // Phase 3: wait for any straggler Layer 3 locks to drain.
    // 35s = JobManager.cancelTimeoutMs (30s) + 5s buffer.
    await this.waitForBaseWriteLocks(baseId, DEFAULT_LOCK_WAIT_TIMEOUT_MS)

    // Phase 4 (locked): clean stale vectors + stale leaf DB rows for any
    // container roots, then re-enqueue.
    await this.runWithBaseWriteLockForBase(baseId, async () => {
      const leafItems = filterIndexableKnowledgeItems(
        await knowledgeItemService.getLeafDescendantItems(baseId, rootIds)
      )
      if (leafItems.length > 0) {
        await deleteItemVectors(
          base,
          leafItems.map((item) => item.id)
        )
      }

      const containers = rootItems.filter(isContainerKnowledgeItem)
      if (containers.length > 0) {
        // Drop the previous expansion so prepare-root can recreate fresh leaves.
        await knowledgeItemService.deleteLeafDescendantItems(
          baseId,
          containers.map((item) => item.id)
        )
      }

      for (const item of rootItems) {
        await knowledgeItemService.updateStatus(
          item.id,
          'processing',
          isContainerKnowledgeItem(item) ? { phase: 'preparing' } : undefined
        )
        await this.enqueueRootItem(item)
      }
    })
  }

  async deleteItems(baseId: string, rootItems: KnowledgeItem[]): Promise<void> {
    const jobManager = application.get('JobManager')
    const base = await knowledgeBaseService.getById(baseId)
    const rootIds = [...new Set(rootItems.map((item) => item.id))]

    let jobIdsToCancel: string[] = []
    await this.runWithBaseWriteLockForBase(baseId, async () => {
      const allItems = await knowledgeItemService.getDescendantAndSelfItems(baseId, rootIds)
      const allItemIds = new Set(allItems.map((item) => item.id))
      const activeJobs = await jobManager.list({
        queue: `base.${baseId}`,
        status: [...ACTIVE_STATUSES],
        limit: ACTIVE_JOB_LIMIT
      })
      jobIdsToCancel = activeJobs
        .filter((job) => allItemIds.has((job.input as JobInputWithItem)?.itemId ?? ''))
        .map((job) => job.id)
    })

    await Promise.all(
      jobIdsToCancel.map((jobId) =>
        jobManager.cancel(jobId, 'delete-items').catch((error) => {
          logger.warn('delete-items cancel failed (job may already be terminal)', {
            jobId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      )
    )

    await this.waitForBaseWriteLocks(baseId, DEFAULT_LOCK_WAIT_TIMEOUT_MS)

    // Cleanup vectors for leaf items in the subtree. The orchestration layer
    // deletes the knowledge_item DB rows after this returns.
    await this.runWithBaseWriteLockForBase(baseId, async () => {
      const leafItems = filterIndexableKnowledgeItems(
        await knowledgeItemService.getLeafDescendantItems(baseId, rootIds)
      )
      if (leafItems.length > 0) {
        await deleteItemVectors(
          base,
          leafItems.map((item) => item.id)
        )
      }
    })
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    if (!SEARCH_TOKEN_PATTERN.test(query)) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    const base = await knowledgeBaseService.getById(baseId)
    const model = getEmbedModel(base)
    const embedResult = await embedMany({ model, values: [query] })
    const queryEmbedding = embedResult.embeddings[0]

    if (!queryEmbedding?.length) {
      throw new Error('Failed to embed search query: model returned empty result')
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const results = await vectorStore.query({
      queryStr: query,
      queryEmbedding,
      mode: base.searchMode ?? 'default',
      similarityTopK: base.documentCount ?? 10,
      alpha: base.hybridAlpha
    })
    const nodes = results.nodes ?? []
    const scoreKind = getInitialSearchScoreKind(base)
    const searchResults = nodes.map((node, index) => {
      const metadata = KnowledgeChunkMetadataSchema.parse(node.metadata ?? {})

      return {
        pageContent: node.getContent(MetadataMode.NONE),
        score: results.similarities[index] ?? 0,
        scoreKind,
        rank: index + 1,
        metadata,
        itemId: metadata.itemId,
        chunkId: node.id_
      }
    })

    if (base.rerankModelId) {
      const rerankedResults = await rerankKnowledgeSearchResults(base, query, searchResults)
      return withSearchRanks(applyRelevanceThreshold(rerankedResults, base.threshold))
    }

    return withSearchRanks(applyRelevanceThreshold(searchResults, base.threshold))
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const base = await knowledgeBaseService.getById(baseId)
    const leafItems = await knowledgeItemService.getLeafDescendantItems(baseId, [itemId])
    if (leafItems.length === 0) {
      return []
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const chunkGroups = await Promise.all(leafItems.map((item) => vectorStore.listByExternalId(item.id)))

    return chunkGroups.flat().map(mapChunkDocument)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)

    await vectorStore.deleteByIdAndExternalId(chunkId, itemId)
  }

  /**
   * Acquire the Layer 3 mutex for `baseId`, run `task`, release the mutex.
   * Promise-chain serialization composes naturally across handler instances
   * (including those re-instantiated after crash + retry).
   *
   * @internal Knowledge job handlers call this through
   *   `application.get('KnowledgeRuntimeService').runWithBaseWriteLockForBase(...)`.
   *   Do not call from outside the knowledge module — the lock is a private
   *   invariant of the indexing pipeline.
   */
  async runWithBaseWriteLockForBase<T>(baseId: string, task: () => Promise<T>): Promise<T> {
    const previousLock = this.baseWriteLocks.get(baseId) ?? Promise.resolve()
    let releaseCurrentLock!: () => void
    const currentLock = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve
    })
    const nextLock = previousLock.catch(() => undefined).then(() => currentLock)

    this.baseWriteLocks.set(baseId, nextLock)

    try {
      await previousLock.catch(() => undefined)
      return await task()
    } finally {
      releaseCurrentLock()
      if (this.baseWriteLocks.get(baseId) === nextLock) {
        this.baseWriteLocks.delete(baseId)
      }
    }
  }

  /**
   * Wait for Layer 3 locks to drain. When `baseId` is given waits only for
   * that base; otherwise waits for every active lock. `timeoutMs` caps the
   * wait; on timeout this logs a warning and returns so the caller (e.g.
   * deleteBase) can proceed past a wedged handler.
   */
  async waitForBaseWriteLocks(baseId?: string, timeoutMs?: number): Promise<void> {
    const locks =
      baseId === undefined
        ? [...this.baseWriteLocks.values()]
        : [this.baseWriteLocks.get(baseId)].filter((l): l is Promise<void> => l !== undefined)

    if (locks.length === 0) {
      return
    }

    const allSettled = Promise.allSettled(locks).then(() => undefined)
    if (timeoutMs === undefined) {
      await allSettled
      return
    }

    let timeoutHandle: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs)
    })

    try {
      const winner = await Promise.race([allSettled.then(() => 'done' as const), timeout])
      if (winner === 'timeout') {
        logger.warn('waitForBaseWriteLocks timed out', {
          baseId: baseId ?? null,
          timeoutMs,
          lockCount: locks.length
        })
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  private async enqueueRootItem(item: KnowledgeItem): Promise<void> {
    const jobManager = application.get('JobManager')

    if (isContainerKnowledgeItem(item)) {
      await jobManager.enqueue(
        'knowledge.prepare-root',
        { baseId: item.baseId, itemId: item.id },
        { idempotencyKey: `knowledge:${item.baseId}:${item.id}` }
      )
      return
    }

    await jobManager.enqueue(
      'knowledge.index-leaf',
      { baseId: item.baseId, itemId: item.id, parentJobId: null },
      { idempotencyKey: `knowledge:${item.baseId}:${item.id}` }
    )
  }

  private async deleteAcceptedItemsBestEffort(
    items: KnowledgeItem[],
    originalError: Error,
    baseId: string
  ): Promise<void> {
    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()]

    for (const item of uniqueItems) {
      try {
        await knowledgeItemService.delete(item.id)
      } catch (cleanupError) {
        logger.error(
          'Failed to rollback accepted knowledge item after addItems failure',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          {
            baseId,
            itemId: item.id,
            addError: originalError.message
          }
        )
      }
    }
  }
}
