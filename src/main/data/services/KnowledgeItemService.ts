/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import type { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { knowledgeItemRepository } from '@data/repositories/KnowledgeItemRepository'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  CreateKnowledgeItemsDto,
  KnowledgeItemsQuery,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import { getCreateKnowledgeItemsReferenceErrors } from '@shared/data/api/schemas/knowledges'
import {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  type KnowledgeItem,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const KNOWLEDGE_ITEM_DATA_SCHEMAS = {
  file: FileItemDataSchema,
  url: UrlItemDataSchema,
  note: NoteItemDataSchema,
  sitemap: SitemapItemDataSchema,
  directory: DirectoryItemDataSchema
} as const

function getCreateKnowledgeItemGroupingErrors(
  plannedItems: CreateKnowledgeItemsDto['items']
): Record<string, string[]> {
  const itemsByRef = new Map(
    plannedItems
      .filter((item): item is (typeof plannedItems)[number] & { ref: string } => typeof item.ref === 'string')
      .map((item) => [item.ref, item] as const)
  )

  for (const item of plannedItems) {
    if (item.ref && item.groupRef === item.ref) {
      return {
        groupRef: ['Knowledge item cannot reference itself as group owner']
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>()

  const hasCycle = (ref: string): boolean => {
    const state = visitState.get(ref)
    if (state === 'visiting') {
      return true
    }
    if (state === 'visited') {
      return false
    }

    visitState.set(ref, 'visiting')

    const targetRef = itemsByRef.get(ref)?.groupRef
    if (targetRef && itemsByRef.has(targetRef) && hasCycle(targetRef)) {
      return true
    }

    visitState.set(ref, 'visited')
    return false
  }

  for (const ref of itemsByRef.keys()) {
    if (hasCycle(ref)) {
      return {
        groupRef: ['Knowledge item grouping cannot contain cycles within one request batch']
      }
    }
  }

  return {}
}

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  const parseJson = <T>(value: T | string | null | undefined, context?: string): T | null => {
    if (value == null) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch (error) {
        logger.error(`Failed to parse JSON data${context ? ` for ${context}` : ''}`, error as Error)
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Corrupted data in knowledge item${context ? ` '${context}'` : ''}`
        )
      }
    }
    return value as T
  }

  const parsedData = parseJson(row.data, row.id)
  if (!parsedData) {
    throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Knowledge item '${row.id}' has missing or null data`)
  }

  return {
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    data: parsedData,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  } as KnowledgeItem
}

export class KnowledgeItemService {
  async list(baseId: string, query: KnowledgeItemsQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    await knowledgeBaseService.getById(baseId)
    const { rows, total } = await knowledgeItemRepository.list(baseId, query)

    return {
      items: rows.map((row) => rowToKnowledgeItem(row)),
      total,
      page: query.page
    }
  }

  async createMany(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    await knowledgeBaseService.getById(baseId)

    const referenceErrors = getCreateKnowledgeItemsReferenceErrors(dto.items)
    if (Object.keys(referenceErrors).length > 0) {
      throw DataApiErrorFactory.validation(referenceErrors)
    }

    const groupingErrors = getCreateKnowledgeItemGroupingErrors(dto.items)
    if (Object.keys(groupingErrors).length > 0) {
      throw DataApiErrorFactory.validation(groupingErrors)
    }

    const plannedItems = dto.items.map((item, index) => {
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[item.type].safeParse(item.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: [`Data payload does not match knowledge item type '${item.type}'`]
        })
      }

      return {
        ...item,
        parsedData: parsed.data,
        index
      }
    })

    const requestedGroupIds = [...new Set(plannedItems.flatMap((item) => (item.groupId != null ? [item.groupId] : [])))]
    const existingGroupIds = await knowledgeItemRepository.getExistingGroupIdsInBase(baseId, requestedGroupIds)
    const missingGroupIds = requestedGroupIds.filter((groupId) => !existingGroupIds.has(groupId))

    if (missingGroupIds.length > 0) {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner not found in base '${baseId}': ${missingGroupIds.join(', ')}`]
      })
    }

    const createdRows = await knowledgeItemRepository.createMany(baseId, plannedItems)

    const items = plannedItems.map((item) => {
      const createdRow = createdRows[item.index]
      if (!createdRow) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item create result missing for index '${item.index}'`
        )
      }

      return rowToKnowledgeItem(createdRow)
    })

    logger.info('Created knowledge items', { baseId, count: items.length })
    return { items }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const row = await knowledgeItemRepository.findById(id)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async getByIdsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const uniqueItemIds = [...new Set(itemIds)]

    if (uniqueItemIds.length === 0) {
      return []
    }

    const rows = await knowledgeItemRepository.getByIdsInBase(baseId, uniqueItemIds)
    const itemsById = new Map(rows.map((row) => [row.id, rowToKnowledgeItem(row)]))

    for (const itemId of uniqueItemIds) {
      if (!itemsById.has(itemId)) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
      }
    }

    return uniqueItemIds.map((itemId) => itemsById.get(itemId)!)
  }

  async getCascadeIdsInBase(baseId: string, rootIds: string[]): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return []
    }

    await this.getByIdsInBase(baseId, uniqueRootIds)
    const descendantIds = await knowledgeItemRepository.getCascadeDescendantIdsInBase(baseId, uniqueRootIds)

    const rootIdSet = new Set(uniqueRootIds)
    return [...uniqueRootIds, ...descendantIds.filter((id) => !rootIdSet.has(id))]
  }

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const existing = await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.data !== undefined) {
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[existing.type].safeParse(dto.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          data: [`Data payload does not match the existing knowledge item type '${existing.type}'`]
        })
      }
      updates.data = parsed.data
    }
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const row = await knowledgeItemRepository.update(id, updates)
    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Knowledge item update result missing for id '${id}'`)
    }
    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return rowToKnowledgeItem(row)
  }

  async delete(id: string): Promise<void> {
    await this.getById(id)
    await knowledgeItemRepository.delete(id)
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = new KnowledgeItemService()
