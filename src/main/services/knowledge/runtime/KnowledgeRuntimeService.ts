import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import {
  type KnowledgeBase,
  KnowledgeChunkMetadataSchema,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { rerankKnowledgeSearchResults } from '../rerank/rerank'
import { getEmbedModel } from '../utils/model'
import { KnowledgeAddQueue } from './KnowledgeAddQueue'
import { KnowledgeAddRuntime } from './KnowledgeAddRuntime'
import { deleteItemVectors, deleteVectorsForEntries, failItems } from './utils/cleanup'
import { DELETE_INTERRUPTED_REASON, SHUTDOWN_INTERRUPTED_REASON } from './utils/taskRuntime'

@Injectable('KnowledgeRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService'])
export class KnowledgeRuntimeService extends BaseService {
  private isStopping = false
  private addRuntime = new KnowledgeAddRuntime(() => this.isStopping)
  private addQueue = new KnowledgeAddQueue(5, (entry) => {
    if (this.isStopping) {
      throw new Error(SHUTDOWN_INTERRUPTED_REASON)
    }

    return this.addRuntime.executeAdd(entry)
  })

  protected onInit(): void {
    this.isStopping = false
    this.addQueue.reset()
  }

  protected async onStop(): Promise<void> {
    this.isStopping = true

    const interruptedEntries = this.addQueue.interruptAll('stop', SHUTDOWN_INTERRUPTED_REASON)
    const interruptedItemIds = interruptedEntries.map((entry) => entry.item.id)

    await this.addQueue.waitForRunning(interruptedItemIds)
    await deleteVectorsForEntries(interruptedEntries, { continueOnError: true })
    await failItems(interruptedItemIds, SHUTDOWN_INTERRUPTED_REASON)
  }

  async createBase(base: KnowledgeBase) {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.createStore(base)
  }

  async deleteBase(baseId: string) {
    const interruptedEntries = this.addQueue.interruptBase(baseId, 'delete', DELETE_INTERRUPTED_REASON)
    const interruptedItemIds = interruptedEntries.map((entry) => entry.item.id)

    await this.addQueue.waitForRunning(interruptedItemIds)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.deleteStore(baseId)
  }

  async addItems(base: KnowledgeBase, items: KnowledgeItem[]): Promise<void> {
    await Promise.all(
      items.map((item) =>
        knowledgeItemService.update(item.id, {
          status: 'pending',
          error: null
        })
      )
    )

    if (this.isStopping) {
      await failItems(
        items.map((item) => item.id),
        SHUTDOWN_INTERRUPTED_REASON
      )
      return
    }

    for (const item of items) {
      this.addQueue.enqueue(base, item).catch(() => undefined)
    }
  }

  async deleteItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    const rootIds = [...new Set(items.map((item) => item.id))]
    const itemIds = await knowledgeItemService.getCascadeIdsInBase(base.id, rootIds)

    this.addQueue.interrupt(itemIds, 'delete', DELETE_INTERRUPTED_REASON)
    await this.addQueue.waitForRunning(itemIds)
    await deleteItemVectors(base, itemIds)
  }

  async search(base: KnowledgeBase, query: string): Promise<KnowledgeSearchResult[]> {
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

  async listItemChunks(base: KnowledgeBase, itemId: string): Promise<KnowledgeItemChunk[]> {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)

    if (!('listByExternalId' in vectorStore) || typeof vectorStore.listByExternalId !== 'function') {
      throw new Error('Knowledge vector store does not support listing item chunks')
    }

    const chunks = await vectorStore.listByExternalId(itemId)

    return chunks.map((chunk) => {
      const metadata = KnowledgeChunkMetadataSchema.parse(chunk.metadata ?? {})

      return {
        id: chunk.id_,
        itemId: metadata.itemId,
        content: chunk.getContent(MetadataMode.NONE),
        metadata
      }
    })
  }
}
