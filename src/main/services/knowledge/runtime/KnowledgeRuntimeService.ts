import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import {
  type KnowledgeBase,
  KnowledgeChunkMetadataSchema,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeItemOf,
  type KnowledgeRuntimeAddItemInput,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { KnowledgeQueueManager } from '../queue/KnowledgeQueueManager'
import type { KnowledgeQueueTaskContext, KnowledgeQueueTaskEntry } from '../queue/types'
import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { rerankKnowledgeSearchResults } from '../rerank/rerank'
import type { IndexableKnowledgeItem } from '../types/items'
import { chunkDocuments } from '../utils/chunk'
import { embedDocuments } from '../utils/embed'
import { filterIndexableKnowledgeItems, isIndexableKnowledgeItem, normalizeAddItemInput } from '../utils/items'
import { getEmbedModel } from '../utils/model'
import { deleteItemVectors, deleteVectorsForEntries, failItems } from './utils/cleanup'
import { prepareKnowledgeItem } from './utils/prepare'

const logger = loggerService.withContext('KnowledgeRuntimeService')

const SHUTDOWN_INTERRUPTED_REASON = 'Knowledge task interrupted by service shutdown'
const DELETE_INTERRUPTED_REASON = 'Knowledge task interrupted by item deletion'
const REINDEX_INTERRUPTED_REASON = 'Knowledge task interrupted by reindex'

const mapChunkDocument = (chunk: {
  id_: string
  metadata: unknown
  getContent: (mode?: MetadataMode) => string
}): KnowledgeItemChunk => {
  const metadata = KnowledgeChunkMetadataSchema.parse(chunk.metadata ?? {})

  return {
    id: chunk.id_,
    itemId: metadata.itemId,
    content: chunk.getContent(MetadataMode.NONE),
    metadata
  }
}

@Injectable('KnowledgeRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService'])
export class KnowledgeRuntimeService extends BaseService {
  private queue = new KnowledgeQueueManager()

  protected onInit(): void {
    this.queue = new KnowledgeQueueManager()
  }

  protected async onStop(): Promise<void> {
    const interruptedEntries = this.queue.interruptAll(SHUTDOWN_INTERRUPTED_REASON)
    await this.queue.waitForRunning(interruptedEntries.map((entry) => entry.itemId))
    await this.cleanupInterruptedEntries(interruptedEntries, SHUTDOWN_INTERRUPTED_REASON)
  }

  async createBase(baseId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.createStore(base)
  }

  async deleteBase(baseId: string): Promise<void> {
    const interruptedEntries = this.queue.interruptBase(baseId, DELETE_INTERRUPTED_REASON)
    await this.queue.waitForRunning(interruptedEntries.map((entry) => entry.itemId))

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    try {
      await vectorStoreService.deleteStore(baseId)
    } catch (error) {
      const cleanupEntries = await this.expandInterruptedEntries(interruptedEntries)
      await this.failItemsAndRethrow(
        cleanupEntries.flatMap((entry) => entry.itemIds),
        error
      )
    }
  }

  async addItems(baseId: string, inputs: KnowledgeRuntimeAddItemInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    const base = await knowledgeBaseService.getById(baseId)
    const acceptedItems: KnowledgeItem[] = []

    try {
      for (const input of inputs) {
        const createdItem = await knowledgeItemService.create(base.id, normalizeAddItemInput(input))
        acceptedItems.push(createdItem)
        acceptedItems[acceptedItems.length - 1] =
          createdItem.type === 'directory' || createdItem.type === 'sitemap'
            ? await knowledgeItemService.updateStatus(createdItem.id, 'processing', { phase: 'preparing' })
            : await knowledgeItemService.updateStatus(createdItem.id, 'processing')
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      await failItems(
        acceptedItems.map((item) => item.id),
        normalizedError.message
      )
      throw error
    }

    for (const item of acceptedItems) {
      await this.submitRuntimeItem(base, item)
    }
  }

  async reindexItems(baseId: string, rootItems: KnowledgeItem[]): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const rootIds = [...new Set(rootItems.map((item) => item.id))]
    let interruptIds = rootIds

    try {
      const interrupted = await this.interruptRootsAndDescendants(base.id, rootIds, REINDEX_INTERRUPTED_REASON)
      interruptIds = interrupted.interruptIds

      const leafItems = filterIndexableKnowledgeItems(
        await knowledgeItemService.getLeafDescendantItems(base.id, rootIds)
      )
      await this.deleteItemVectorsOrFailItems(
        base,
        leafItems.map((item) => item.id),
        interruptIds
      )

      const containerItems = rootItems.filter(
        (item): item is KnowledgeItemOf<'directory'> | KnowledgeItemOf<'sitemap'> =>
          item.type === 'directory' || item.type === 'sitemap'
      )
      if (containerItems.length > 0) {
        // Reindexing directory/sitemap roots rebuilds their leaf children from the source:
        // old leaf items are deleted here, then preparation creates fresh leaf items to index.
        await knowledgeItemService.deleteLeafDescendantItems(
          base.id,
          containerItems.map((item) => item.id)
        )
      }

      for (const containerItem of containerItems) {
        const preparedRoot = await knowledgeItemService.updateStatus(containerItem.id, 'processing', {
          phase: 'preparing'
        })
        await this.submitRuntimeItem(base, preparedRoot)
      }

      for (const leafItem of rootItems.filter(isIndexableKnowledgeItem)) {
        const processingItem = await knowledgeItemService.updateStatus(leafItem.id, 'processing')
        if (isIndexableKnowledgeItem(processingItem)) {
          this.enqueueIndexItem(base, processingItem)
        }
      }
    } catch (error) {
      await this.failItemsAndRethrow(interruptIds, error)
    }
  }

  async deleteItems(baseId: string, rootItems: KnowledgeItem[]): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const rootIds = [...new Set(rootItems.map((item) => item.id))]
    let interruptIds = rootIds

    try {
      const interrupted = await this.interruptRootsAndDescendants(base.id, rootIds, DELETE_INTERRUPTED_REASON)
      interruptIds = interrupted.interruptIds

      const leafItems = filterIndexableKnowledgeItems(
        await knowledgeItemService.getLeafDescendantItems(base.id, rootIds)
      )
      await this.deleteItemVectorsOrFailItems(
        base,
        leafItems.map((item) => item.id),
        interruptIds
      )
    } catch (error) {
      await this.failItemsAndRethrow(interruptIds, error)
    }
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
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
    const searchResults = nodes.map((node, index) => {
      const metadata = KnowledgeChunkMetadataSchema.parse(node.metadata ?? {})

      return {
        pageContent: node.getContent(MetadataMode.NONE),
        score: results.similarities[index] ?? 0,
        metadata,
        itemId: metadata.itemId,
        chunkId: node.id_
      }
    })

    if (base.rerankModelId) {
      return await rerankKnowledgeSearchResults(base, query, searchResults)
    }

    return searchResults
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const chunks = await vectorStore.listByExternalId(itemId)

    return chunks.map(mapChunkDocument)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)

    await vectorStore.deleteByIdAndExternalId(chunkId, itemId)
  }

  private async submitRuntimeItem(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    if (isIndexableKnowledgeItem(item)) {
      this.enqueueIndexItem(base, item)
      return
    }

    if (item.type === 'directory' || item.type === 'sitemap') {
      this.enqueuePrepareRoot(base, item)
    }
  }

  private enqueueIndexItem(base: KnowledgeBase, item: IndexableKnowledgeItem): void {
    const promise = this.queue.enqueue({
      base,
      baseId: base.id,
      itemId: item.id,
      kind: 'index-leaf',
      execute: (context) => this.executeIndexTask(base, item, context)
    })

    void promise.catch(() => undefined)
  }

  private enqueuePrepareRoot(
    base: KnowledgeBase,
    item: KnowledgeItemOf<'directory'> | KnowledgeItemOf<'sitemap'>
  ): void {
    const promise = this.queue.enqueue({
      base,
      baseId: base.id,
      itemId: item.id,
      kind: 'prepare-root',
      execute: (context) => this.executePrepareTask(base, item, context)
    })

    void promise.catch(() => undefined)
  }

  private async executePrepareTask(
    base: KnowledgeBase,
    item: KnowledgeItemOf<'directory'> | KnowledgeItemOf<'sitemap'>,
    context: KnowledgeQueueTaskContext
  ): Promise<void> {
    const createdItemIds = new Set<string>([item.id])

    try {
      const leafItems = await prepareKnowledgeItem({
        baseId: base.id,
        item,
        onCreatedItem: (createdItem) => createdItemIds.add(createdItem.id),
        signal: context.signal
      })

      for (const leafItem of leafItems) {
        if (await this.shouldEnqueueLeaf(leafItem.id)) {
          context.signal.throwIfAborted()
          this.enqueueIndexItem(base, leafItem)
        }
      }

      await context.runWithBaseWriteLock(async () => {
        await knowledgeItemService.updateStatus(item.id, 'processing')
        context.signal.throwIfAborted()
        await knowledgeItemService.reconcileContainers(base.id, [item.id])
      })
    } catch (error) {
      if (context.signal.aborted) {
        context.signal.throwIfAborted()
        throw error
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error))
      await this.cleanupFailedItems(base, [...createdItemIds], item, normalizedError)
      throw normalizedError
    }
  }

  private async executeIndexTask(
    base: KnowledgeBase,
    item: IndexableKnowledgeItem,
    context: KnowledgeQueueTaskContext
  ): Promise<void> {
    try {
      await this.indexLeafItem(base, item, context)
    } catch (error) {
      if (context.signal.aborted) {
        context.signal.throwIfAborted()
        throw error
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error))
      await this.cleanupFailedItems(base, [item.id], item, normalizedError)
      throw normalizedError
    }
  }

  private async indexLeafItem(
    base: KnowledgeBase,
    item: IndexableKnowledgeItem,
    context: KnowledgeQueueTaskContext
  ): Promise<void> {
    context.signal.throwIfAborted()
    await context.runWithBaseWriteLock(() =>
      knowledgeItemService.updateStatus(item.id, 'processing', { phase: 'reading' })
    )
    const documents = await this.runTaskStep(context, () => loadKnowledgeItemDocuments(item, context.signal))
    const chunks = await this.runTaskStep(context, () => chunkDocuments(base, item, documents))
    await context.runWithBaseWriteLock(() =>
      knowledgeItemService.updateStatus(item.id, 'processing', { phase: 'embedding' })
    )
    const nodes = await this.runTaskStep(context, () => embedDocuments(getEmbedModel(base), chunks, context.signal))

    await context.runWithBaseWriteLock(async () => {
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      const activeVectorStore = await this.runTaskStep(context, () => vectorStoreService.createStore(base))

      await this.runTaskStep(context, () => activeVectorStore.add(nodes))
      await knowledgeItemService.updateStatus(item.id, 'completed')
    })
  }

  private async cleanupFailedItems(
    base: KnowledgeBase,
    itemIds: string[],
    logItem: KnowledgeItem,
    error: Error
  ): Promise<void> {
    logger.error('Failed to process knowledge item runtime task', error, {
      baseId: base.id,
      itemId: logItem.id,
      itemType: logItem.type
    })

    try {
      await deleteItemVectors(base, itemIds)
    } catch (cleanupError) {
      logger.warn('Failed to cleanup knowledge item vectors after runtime failure', {
        baseId: base.id,
        itemIds,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    }

    await failItems(itemIds, error.message)
  }

  private async deleteItemVectorsOrFailItems(
    base: KnowledgeBase,
    vectorItemIds: string[],
    failureItemIds: string[]
  ): Promise<void> {
    try {
      await deleteItemVectors(base, vectorItemIds)
    } catch (error) {
      await this.failItemsAndRethrow(failureItemIds, error)
    }
  }

  private async failItemsAndRethrow(itemIds: string[], error: unknown): Promise<never> {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    await failItems(itemIds, normalizedError.message)
    throw error
  }

  private async interruptRootsAndDescendants(
    baseId: string,
    rootIds: string[],
    reason: string
  ): Promise<{ descendantItems: KnowledgeItem[]; interruptIds: string[] }> {
    this.queue.interruptItems(rootIds, reason)
    await this.queue.waitForRunning(rootIds)

    const descendantItems = await knowledgeItemService.getDescendantItems(baseId, rootIds)
    const interruptIds = [...rootIds, ...descendantItems.map((item) => item.id)]
    this.queue.interruptItems(interruptIds, reason)
    await this.queue.waitForRunning(interruptIds)

    return { descendantItems, interruptIds }
  }

  private async runTaskStep<T>(context: KnowledgeQueueTaskContext, step: () => Promise<T> | T): Promise<T> {
    context.signal.throwIfAborted()
    const result = await step()
    context.signal.throwIfAborted()
    return result
  }

  private async shouldEnqueueLeaf(itemId: string): Promise<boolean> {
    try {
      const item = await knowledgeItemService.getById(itemId)
      return isIndexableKnowledgeItem(item) && item.status === 'processing'
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return false
      }

      throw error
    }
  }

  private async cleanupInterruptedEntries(entries: KnowledgeQueueTaskEntry[], reason: string): Promise<void> {
    const cleanupEntries = await this.expandInterruptedEntries(entries)
    await this.deleteVectorsForQueueEntries(cleanupEntries)
    await failItems(
      cleanupEntries.flatMap((entry) => entry.itemIds),
      reason
    )
  }

  private async expandInterruptedEntries(
    entries: KnowledgeQueueTaskEntry[]
  ): Promise<Array<{ base: KnowledgeBase; baseId: string; itemIds: string[] }>> {
    const expandedEntries: Array<{ base: KnowledgeBase; baseId: string; itemIds: string[] }> = []

    for (const entry of entries) {
      if (entry.kind === 'index-leaf') {
        expandedEntries.push({ base: entry.base, baseId: entry.baseId, itemIds: [entry.itemId] })
        continue
      }

      const descendantItems = await knowledgeItemService.getDescendantItems(entry.baseId, [entry.itemId])
      expandedEntries.push({
        base: entry.base,
        baseId: entry.baseId,
        itemIds: [entry.itemId, ...descendantItems.map((item) => item.id)]
      })
    }

    return expandedEntries
  }

  private async deleteVectorsForQueueEntries(
    entries: Array<{ base: KnowledgeBase; baseId: string; itemIds: string[] }>
  ): Promise<void> {
    const entriesByBase = new Map<string, { base: KnowledgeBase; itemIds: string[] }>()
    for (const entry of entries) {
      const existing = entriesByBase.get(entry.baseId)
      if (existing) {
        existing.itemIds.push(...entry.itemIds)
        continue
      }

      entriesByBase.set(entry.baseId, {
        base: entry.base,
        itemIds: entry.itemIds
      })
    }

    await deleteVectorsForEntries([...entriesByBase.values()])
  }
}
