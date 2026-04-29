import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemOf,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../../types/items'
import { expandDirectoryOwnerToTree, type ExpandedDirectoryNode } from '../../utils/directory'
import { isIndexableKnowledgeItem } from '../../utils/items'
import { expandSitemapOwnerToCreateItems } from '../../utils/sitemap'

export interface PrepareKnowledgeItemOptions {
  baseId: string
  item: KnowledgeItem
  onCreatedItem: (item: KnowledgeItem) => void
  signal: AbortSignal
}

export async function prepareKnowledgeItem({
  baseId,
  item,
  onCreatedItem,
  signal
}: PrepareKnowledgeItemOptions): Promise<IndexableKnowledgeItem[]> {
  signal.throwIfAborted()

  if (isIndexableKnowledgeItem(item)) {
    return [item]
  }

  if (item.type === 'directory') {
    return await prepareDirectoryForRuntime(baseId, item, onCreatedItem, signal)
  }

  return await prepareSitemapForRuntime(baseId, item, onCreatedItem, signal)
}

async function prepareDirectoryForRuntime(
  baseId: string,
  item: KnowledgeItemOf<'directory'>,
  onCreatedItem: (item: KnowledgeItem) => void,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  const expandedChildren = await expandDirectoryOwnerToTree(item, signal)
  signal.throwIfAborted()

  if (expandedChildren.length === 0) {
    await knowledgeItemService.updateStatus(item.id, 'processing')
    return []
  }

  return await createDirectoryChildren(baseId, item.id, expandedChildren, onCreatedItem, signal)
}

async function createDirectoryChildren(
  baseId: string,
  parentId: string,
  children: ExpandedDirectoryNode[],
  onCreatedItem: (item: KnowledgeItem) => void,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  const leafItems: IndexableKnowledgeItem[] = []

  for (const child of children) {
    signal.throwIfAborted()

    if (child.type === 'file') {
      const createdFile = await createRuntimeItem(
        baseId,
        {
          groupId: parentId,
          type: 'file',
          data: child.data
        },
        onCreatedItem,
        signal
      )
      leafItems.push(createdFile)
      continue
    }

    const createdDirectory = await createRuntimeItem(
      baseId,
      {
        groupId: parentId,
        type: 'directory',
        data: child.data
      },
      onCreatedItem,
      signal
    )
    const childLeafItems = await createDirectoryChildren(
      baseId,
      createdDirectory.id,
      child.children,
      onCreatedItem,
      signal
    )
    await knowledgeItemService.updateStatus(createdDirectory.id, 'processing')
    leafItems.push(...childLeafItems)
  }

  return leafItems
}

async function prepareSitemapForRuntime(
  baseId: string,
  item: KnowledgeItemOf<'sitemap'>,
  onCreatedItem: (item: KnowledgeItem) => void,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  const expandedItems = await expandSitemapOwnerToCreateItems(item, signal)
  signal.throwIfAborted()

  if (expandedItems.length === 0) {
    await knowledgeItemService.updateStatus(item.id, 'processing')
    return []
  }

  const leafItems: IndexableKnowledgeItem[] = []

  for (const expandedItem of expandedItems) {
    signal.throwIfAborted()
    const createdItem = await createRuntimeItem(baseId, expandedItem, onCreatedItem, signal)
    leafItems.push(createdItem)
  }

  return leafItems
}

async function createRuntimeItem<T extends KnowledgeItemType>(
  baseId: string,
  item: Extract<CreateKnowledgeItemDto, { type: T }>,
  onCreatedItem: (item: KnowledgeItem) => void,
  signal: AbortSignal
): Promise<KnowledgeItemOf<T>> {
  signal.throwIfAborted()
  const createdItem = await knowledgeItemService.create(baseId, item)
  onCreatedItem(createdItem)

  const processingItem =
    createdItem.type === 'directory' || createdItem.type === 'sitemap'
      ? await knowledgeItemService.updateStatus(createdItem.id, 'processing', { phase: 'preparing' })
      : await knowledgeItemService.updateStatus(createdItem.id, 'processing')
  signal.throwIfAborted()

  return processingItem as KnowledgeItemOf<T>
}
