import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'

import { expandDirectoryOwnerToCreateItems } from './utils/directory'
import { expandSitemapOwnerToCreateItems } from './utils/sitemap'

@Injectable('KnowledgeOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeRuntimeService'])
export class KnowledgeOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  async createBase(baseId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.createBase(base)
  }

  async deleteBase(baseId: string): Promise<void> {
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteBase(baseId)
  }

  async addItems(baseId: string, itemIds: string[]): Promise<void[]> {
    const [base, items] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, itemIds)
    ])

    const expandedLeafItems = await this.expandAndCreateLeafItems(baseId, items)
    const allLeafItems = this.collectIndexableItems([...items, ...expandedLeafItems])

    if (allLeafItems.length === 0) {
      return []
    }

    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.addItems(base, allLeafItems)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const [base, items] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, itemIds)
    ])

    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteItems(base, items)
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    const base = await knowledgeBaseService.getById(baseId)
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.search(base, query)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: { baseId: string }) => {
      return await this.createBase(payload.baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: { baseId: string }) => {
      return await this.deleteBase(payload.baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: { baseId: string; itemIds: string[] }) => {
      return await this.addItems(payload.baseId, payload.itemIds)
    })
    this.ipcHandle(
      IpcChannel.KnowledgeRuntime_DeleteItems,
      async (_, payload: { baseId: string; itemIds: string[] }) => {
        return await this.deleteItems(payload.baseId, payload.itemIds)
      }
    )
    this.ipcHandle(IpcChannel.KnowledgeRuntime_Search, async (_, payload: { baseId: string; query: string }) => {
      return await this.search(payload.baseId, payload.query)
    })
  }

  private async expandAndCreateLeafItems(baseId: string, items: KnowledgeItem[]): Promise<KnowledgeItem[]> {
    const createdLeafItems: KnowledgeItem[] = []

    for (const item of items) {
      const expandedItems = await this.expandItemToCreateInputs(item)
      if (expandedItems.length === 0) {
        continue
      }

      const { items: createdItems } = await knowledgeItemService.createMany(baseId, {
        items: expandedItems
      })
      createdLeafItems.push(...this.collectIndexableItems(createdItems))
    }

    return createdLeafItems
  }

  private async expandItemToCreateInputs(item: KnowledgeItem): Promise<CreateKnowledgeItemsDto['items']> {
    if (item.type === 'directory') {
      return await expandDirectoryOwnerToCreateItems(item)
    }

    if (item.type === 'sitemap') {
      return await expandSitemapOwnerToCreateItems(item)
    }

    return []
  }

  private collectIndexableItems(items: KnowledgeItem[]): KnowledgeItem[] {
    const leafItems = new Map<string, KnowledgeItem>()

    for (const item of items) {
      if (item.type === 'file' || item.type === 'url' || item.type === 'note') {
        leafItems.set(item.id, item)
      }
    }

    return [...leafItems.values()]
  }
}
