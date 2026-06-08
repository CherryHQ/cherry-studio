import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemOf,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../../types/items'
import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'
import { expandDirectoryOwnerToTree, type ExpandedDirectoryNode } from './directory'

const logger = loggerService.withContext('KnowledgePrepare')
const EMPTY_DIRECTORY_ERROR = 'Directory contains no indexable files'

export interface PrepareKnowledgeItemOptions {
  baseId: string
  item: KnowledgeItem
  onCreatedItem: (item: KnowledgeItem) => void
  runMutation: <T>(task: () => Promise<T>) => Promise<T>
  signal: AbortSignal
}

export async function prepareKnowledgeItem({
  baseId,
  item,
  onCreatedItem,
  runMutation,
  signal
}: PrepareKnowledgeItemOptions): Promise<IndexableKnowledgeItem[]> {
  signal.throwIfAborted()

  if (isIndexableKnowledgeItem(item)) {
    return [item]
  }

  return await prepareDirectoryForRuntime(baseId, item, onCreatedItem, runMutation, signal)
}

async function prepareDirectoryForRuntime(
  baseId: string,
  item: KnowledgeItemOf<'directory'>,
  onCreatedItem: (item: KnowledgeItem) => void,
  runMutation: <T>(task: () => Promise<T>) => Promise<T>,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  const expandedChildren = await expandDirectoryOwnerToTree(item, baseId, signal)
  signal.throwIfAborted()

  if (expandedChildren.length === 0) {
    logger.warn('Directory expansion produced no indexable files', {
      baseId,
      itemId: item.id,
      source: item.data.source
    })
    await runMutation(() => knowledgeItemService.updateStatus(item.id, 'failed', { error: EMPTY_DIRECTORY_ERROR }))
    return []
  }

  return await createDirectoryChildren(baseId, item.id, expandedChildren, onCreatedItem, runMutation, signal)
}

async function createDirectoryChildren(
  baseId: string,
  parentId: string,
  children: ExpandedDirectoryNode[],
  onCreatedItem: (item: KnowledgeItem) => void,
  runMutation: <T>(task: () => Promise<T>) => Promise<T>,
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
        runMutation,
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
      runMutation,
      signal
    )
    const childLeafItems = await createDirectoryChildren(
      baseId,
      createdDirectory.id,
      child.children,
      onCreatedItem,
      runMutation,
      signal
    )
    await runMutation(() => knowledgeItemService.updateStatus(createdDirectory.id, 'processing'))
    leafItems.push(...childLeafItems)
  }

  return leafItems
}

async function createRuntimeItem<T extends KnowledgeItemType>(
  baseId: string,
  item: Extract<CreateKnowledgeItemDto, { type: T }>,
  onCreatedItem: (item: KnowledgeItem) => void,
  runMutation: <TResult>(task: () => Promise<TResult>) => Promise<TResult>,
  signal: AbortSignal
): Promise<KnowledgeItemOf<T>> {
  signal.throwIfAborted()
  const createdItem = await runMutation(() => knowledgeItemService.create(baseId, item))
  onCreatedItem(createdItem)

  const processingItem = await runMutation(() =>
    isContainerKnowledgeItem(createdItem)
      ? knowledgeItemService.updateStatus(createdItem.id, 'preparing')
      : knowledgeItemService.updateStatus(createdItem.id, 'processing')
  )
  signal.throwIfAborted()

  return processingItem as KnowledgeItemOf<T>
}
