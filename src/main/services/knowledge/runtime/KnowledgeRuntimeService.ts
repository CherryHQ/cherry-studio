import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { rerankKnowledgeSearchResults } from '../rerank/rerank'
import { expandDirectoryOwnerToCreateItems } from '../utils/directory'
import { getEmbedModel } from '../utils/model'
import { expandSitemapOwnerToCreateItems } from '../utils/sitemap'
import { KnowledgeAddRuntime } from './addRuntime'
import { KnowledgeAddQueue } from './KnowledgeAddQueue'
import { deleteItemVectors, deleteVectorsForEntries, failItems } from './utils/cleanup'
import { DELETE_INTERRUPTED_REASON, SHUTDOWN_INTERRUPTED_REASON } from './utils/taskRuntime'

@Injectable('KnowledgeRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['DbService', 'KnowledgeVectorStoreService'])
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
    this.registerIpcHandlers()
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

  async addItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    return await Promise.all(
      items.map(async (item) => {
        await knowledgeItemService.update(item.id, {
          status: 'pending',
          error: null
        })

        return await this.addQueue.enqueue(base, item)
      })
    )
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
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const results = await vectorStore.query({
      queryStr: query,
      queryEmbedding: embedResult.embeddings[0],
      mode: base.searchMode ?? 'default',
      similarityTopK: base.documentCount ?? 10,
      alpha: base.hybridAlpha
    })
    const nodes = results.nodes ?? []
    const searchResults = nodes.map((node, index) => ({
      pageContent: node.getContent(MetadataMode.NONE),
      score: results.similarities[index] ?? 0,
      metadata: node.metadata ?? {},
      itemId:
        typeof node.metadata?.itemId === 'string' && node.metadata.itemId.length > 0 ? node.metadata.itemId : undefined,
      chunkId: node.id_
    }))

    return await rerankKnowledgeSearchResults(base, query, searchResults)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: { baseId: string }) => {
      const base = await knowledgeBaseService.getById(payload.baseId)
      return await this.createBase(base)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: { baseId: string }) => {
      return await this.deleteBase(payload.baseId)
    })
    this.ipcHandle(
      IpcChannel.KnowledgeRuntime_ExpandDirectoryItem,
      async (_, payload: { baseId: string; itemId: string }) => {
        await knowledgeBaseService.getById(payload.baseId)
        const [item] = await knowledgeItemService.getByIdsInBase(payload.baseId, [payload.itemId])
        return {
          items: await expandDirectoryOwnerToCreateItems(item)
        }
      }
    )
    this.ipcHandle(
      IpcChannel.KnowledgeRuntime_ExpandSitemapItem,
      async (_, payload: { baseId: string; itemId: string }) => {
        await knowledgeBaseService.getById(payload.baseId)
        const [item] = await knowledgeItemService.getByIdsInBase(payload.baseId, [payload.itemId])
        return {
          items: await expandSitemapOwnerToCreateItems(item)
        }
      }
    )
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: { baseId: string; itemIds: string[] }) => {
      const { base, items } = await this.loadBaseAndItems(payload.baseId, payload.itemIds)
      return await this.addItems(base, items)
    })
    this.ipcHandle(
      IpcChannel.KnowledgeRuntime_DeleteItems,
      async (_, payload: { baseId: string; itemIds: string[] }) => {
        const { base, items } = await this.loadBaseAndItems(payload.baseId, payload.itemIds)
        return await this.deleteItems(base, items)
      }
    )
    this.ipcHandle(IpcChannel.KnowledgeRuntime_Search, async (_, payload: { baseId: string; query: string }) => {
      const base = await knowledgeBaseService.getById(payload.baseId)
      return await this.search(base, payload.query)
    })
  }

  private async loadBaseAndItems(
    baseId: string,
    itemIds: string[]
  ): Promise<{ base: KnowledgeBase; items: KnowledgeItem[] }> {
    const [base, items] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, itemIds)
    ])
    return { base, items }
  }
}
