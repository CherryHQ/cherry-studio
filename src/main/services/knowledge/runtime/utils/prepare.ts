import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemOf,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../../types/items'
import { expandDirectoryOwnerToTree, type ExpandedDirectoryNode } from '../../utils/directory'
import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../../utils/items'
import { expandSitemapOwnerToCreateItems } from '../../utils/sitemap'

const logger = loggerService.withContext('KnowledgeRuntimePrepare')
const EMPTY_DIRECTORY_ERROR = 'Directory contains no indexable files'
const EMPTY_SITEMAP_ERROR = 'Sitemap contains no indexable URLs'

export interface PrepareKnowledgeItemOptions {
  baseId: string
  item: KnowledgeItem
  onCreatedItem: (item: KnowledgeItem) => void
  runMutation: <T>(task: () => Promise<T>) => Promise<T>
  signal: AbortSignal
}

export type PreparedKnowledgeItem =
  | {
      kind: 'leaf'
      item: IndexableKnowledgeItem
    }
  | {
      kind: 'directory'
      children: ExpandedDirectoryNode[]
    }
  | {
      kind: 'sitemap'
      children: Extract<CreateKnowledgeItemDto, { type: 'url' }>[]
    }

export interface ExpandKnowledgeItemOptions {
  item: KnowledgeItem
  signal: AbortSignal
}

export interface CommitPreparedKnowledgeItemOptions extends PrepareKnowledgeItemOptions {
  prepared: PreparedKnowledgeItem
}

export async function expandKnowledgeItemForRuntime({
  item,
  signal
}: ExpandKnowledgeItemOptions): Promise<PreparedKnowledgeItem> {
  signal.throwIfAborted()

  if (isIndexableKnowledgeItem(item)) {
    return { kind: 'leaf', item }
  }

  if (item.type === 'directory') {
    const children = await expandDirectoryOwnerToTree(item, signal)
    signal.throwIfAborted()
    return { kind: 'directory', children }
  }

  const children = await expandSitemapOwnerToCreateItems(item, signal)
  signal.throwIfAborted()
  return { kind: 'sitemap', children }
}

export async function commitPreparedKnowledgeItem({
  baseId,
  item,
  prepared,
  onCreatedItem,
  runMutation,
  signal
}: CommitPreparedKnowledgeItemOptions): Promise<IndexableKnowledgeItem[]> {
  signal.throwIfAborted()

  if (prepared.kind === 'leaf') {
    return [prepared.item]
  }

  if (prepared.kind === 'directory') {
    if (item.type !== 'directory') {
      throw new Error(`Prepared directory result cannot be committed to knowledge item type '${item.type}'`)
    }

    return await commitPreparedDirectory(baseId, item, prepared.children, onCreatedItem, runMutation, signal)
  }

  if (item.type !== 'sitemap') {
    throw new Error(`Prepared sitemap result cannot be committed to knowledge item type '${item.type}'`)
  }

  return await commitPreparedSitemap(baseId, item, prepared.children, onCreatedItem, runMutation, signal)
}

export async function prepareKnowledgeItem(options: PrepareKnowledgeItemOptions): Promise<IndexableKnowledgeItem[]> {
  const prepared = await expandKnowledgeItemForRuntime({ item: options.item, signal: options.signal })
  return await commitPreparedKnowledgeItem({ ...options, prepared })
}

async function commitPreparedDirectory(
  baseId: string,
  item: KnowledgeItemOf<'directory'>,
  expandedChildren: ExpandedDirectoryNode[],
  onCreatedItem: (item: KnowledgeItem) => void,
  runMutation: <T>(task: () => Promise<T>) => Promise<T>,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
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

async function commitPreparedSitemap(
  baseId: string,
  item: KnowledgeItemOf<'sitemap'>,
  expandedItems: Extract<CreateKnowledgeItemDto, { type: 'url' }>[],
  onCreatedItem: (item: KnowledgeItem) => void,
  runMutation: <T>(task: () => Promise<T>) => Promise<T>,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  if (expandedItems.length === 0) {
    logger.warn('Sitemap expansion produced no indexable URLs', {
      baseId,
      itemId: item.id,
      source: item.data.source
    })
    await runMutation(() => knowledgeItemService.updateStatus(item.id, 'failed', { error: EMPTY_SITEMAP_ERROR }))
    return []
  }

  const leafItems: IndexableKnowledgeItem[] = []

  for (const expandedItem of expandedItems) {
    signal.throwIfAborted()
    const createdItem = await createRuntimeItem(baseId, expandedItem, onCreatedItem, runMutation, signal)
    leafItems.push(createdItem)
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
      ? knowledgeItemService.updateStatus(createdItem.id, 'processing', { phase: 'preparing' })
      : knowledgeItemService.updateStatus(createdItem.id, 'processing')
  )
  signal.throwIfAborted()

  return processingItem as KnowledgeItemOf<T>
}
