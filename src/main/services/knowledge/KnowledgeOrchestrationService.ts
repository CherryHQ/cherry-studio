import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { expandDirectoryOwnerToCreateItems } from './utils/directory'
import { expandSitemapOwnerToCreateItems } from './utils/sitemap'

const KnowledgeRuntimeBasePayloadSchema = z
  .object({
    baseId: z.string().trim().min(1)
  })
  .strict()

const KnowledgeRuntimeItemsPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    itemIds: z.array(z.string().trim().min(1)).min(1)
  })
  .strict()

const KnowledgeRuntimeSearchPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    query: z.string().trim().min(1).max(1000)
  })
  .strict()

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

    const expandedItems = await this.expandItemsToCreateInputs(items)
    const expandedLeafItems =
      expandedItems.length === 0
        ? []
        : this.collectIndexableItems(
            (
              await knowledgeItemService.createMany(baseId, {
                items: expandedItems
              })
            ).items
          )

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
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeRuntimeBasePayloadSchema.parse(payload)
      return await this.createBase(baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeRuntimeBasePayloadSchema.parse(payload)
      return await this.deleteBase(baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeRuntimeItemsPayloadSchema.parse(payload)
      return await this.addItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeRuntimeItemsPayloadSchema.parse(payload)
      return await this.deleteItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_Search, async (_, payload: unknown) => {
      const { baseId, query } = KnowledgeRuntimeSearchPayloadSchema.parse(payload)
      return await this.search(baseId, query)
    })
  }

  private async expandItemsToCreateInputs(items: KnowledgeItem[]): Promise<CreateKnowledgeItemsDto['items']> {
    const expandedItems: CreateKnowledgeItemsDto['items'] = []

    for (const item of items) {
      const itemCreateInputs = await this.expandItemToCreateInputs(item)
      if (itemCreateInputs.length === 0) {
        continue
      }

      expandedItems.push(...itemCreateInputs)
    }

    return expandedItems
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
