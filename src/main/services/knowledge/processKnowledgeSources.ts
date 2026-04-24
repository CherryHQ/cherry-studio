import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

import { expandDirectoryOwnerToTree, type ExpandedDirectoryNode } from './utils/directory'
import { expandSitemapOwnerToCreateItems } from './utils/sitemap'

const logger = loggerService.withContext('KnowledgeSourceProcessing')

export async function processKnowledgeSources(base: KnowledgeBase, items: KnowledgeItem[]): Promise<void> {
  const leafItems: KnowledgeItem[] = []
  const parentIdsToRefresh = new Set<string>()

  for (const item of items) {
    try {
      const preparedLeafItems = await prepareItemForRuntime(base.id, item)
      leafItems.push(...preparedLeafItems)
      for (const leafItem of preparedLeafItems) {
        if (leafItem.groupId) {
          parentIdsToRefresh.add(leafItem.groupId)
        }
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to prepare knowledge item for runtime', normalizedError, {
        baseId: base.id,
        itemId: item.id,
        itemType: item.type
      })
      await knowledgeItemService.update(item.id, {
        status: 'failed',
        error: normalizedError.message
      })
      if (item.groupId) {
        parentIdsToRefresh.add(item.groupId)
      }
    }
  }

  if (leafItems.length > 0) {
    try {
      const runtime = application.get('KnowledgeRuntimeService')
      await runtime.addItems(base, leafItems)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      await knowledgeItemService.updateStatuses(
        leafItems.map((item) => item.id),
        {
          status: 'failed',
          error: normalizedError.message
        }
      )
      throw error
    }
  }

  await knowledgeItemService.refreshContainerStatuses([...parentIdsToRefresh])
}

async function prepareItemForRuntime(baseId: string, item: KnowledgeItem): Promise<KnowledgeItem[]> {
  if (isIndexableItem(item)) {
    return [item]
  }

  if (item.type === 'directory') {
    return await prepareDirectoryForRuntime(baseId, item)
  }

  if (item.type === 'sitemap') {
    return await prepareSitemapForRuntime(baseId, item)
  }

  return []
}

async function prepareDirectoryForRuntime(baseId: string, item: KnowledgeItem): Promise<KnowledgeItem[]> {
  const expandedChildren = await expandDirectoryOwnerToTree(item)

  if (expandedChildren.length === 0) {
    await knowledgeItemService.update(item.id, {
      status: 'completed',
      error: null
    })
    return []
  }

  return await createDirectoryChildren(baseId, item.id, expandedChildren)
}

async function createDirectoryChildren(
  baseId: string,
  parentId: string,
  children: ExpandedDirectoryNode[]
): Promise<KnowledgeItem[]> {
  const leafItems: KnowledgeItem[] = []

  for (const child of children) {
    if (child.type === 'file') {
      const [createdFile] = (
        await knowledgeItemService.createManyInBase(
          baseId,
          [
            {
              groupId: parentId,
              type: 'file',
              data: child.data,
              status: 'pending'
            }
          ],
          { status: 'pending' }
        )
      ).items
      leafItems.push(createdFile)
      continue
    }

    const [createdDirectory] = (
      await knowledgeItemService.createManyInBase(
        baseId,
        [
          {
            groupId: parentId,
            type: 'directory',
            data: child.data,
            status: 'pending'
          }
        ],
        { status: 'pending' }
      )
    ).items
    leafItems.push(...(await createDirectoryChildren(baseId, createdDirectory.id, child.children)))
  }

  return leafItems
}

async function prepareSitemapForRuntime(baseId: string, item: KnowledgeItem): Promise<KnowledgeItem[]> {
  const expandedItems = await expandSitemapOwnerToCreateItems(item)

  if (expandedItems.length === 0) {
    await knowledgeItemService.update(item.id, {
      status: 'completed',
      error: null
    })
    return []
  }

  return (
    await knowledgeItemService.createManyInBase(
      baseId,
      expandedItems.map((expandedItem) => ({
        ...expandedItem,
        groupId: item.id,
        status: 'pending'
      })),
      { status: 'pending' }
    )
  ).items.filter((createdItem) => isIndexableItem(createdItem))
}

function isIndexableItem(item: KnowledgeItem): boolean {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}
