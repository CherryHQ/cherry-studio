import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemOf,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'

import { type IndexableKnowledgeItem, isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'
import { collectKnowledgeReservedRelativePaths } from '../pathStorage'
import { expandDirectoryOwnerToTree, type ExpandedDirectoryNode } from '../pipeline/sources/directory'

const logger = loggerService.withContext('KnowledgePrepare')
const EMPTY_DIRECTORY_ERROR = 'Directory contains no indexable files'

export interface PrepareKnowledgeItemOptions {
  baseId: string
  item: KnowledgeItem
  signal: AbortSignal
}

export async function prepareKnowledgeItem({
  baseId,
  item,
  signal
}: PrepareKnowledgeItemOptions): Promise<IndexableKnowledgeItem[]> {
  signal.throwIfAborted()

  if (isIndexableKnowledgeItem(item)) {
    return [item]
  }

  return await prepareDirectoryForRuntime(baseId, item, signal)
}

async function prepareDirectoryForRuntime(
  baseId: string,
  item: KnowledgeItemOf<'directory'>,
  signal: AbortSignal
): Promise<IndexableKnowledgeItem[]> {
  // Exclude this container itself: on reindex it already owns its `relativePath`
  // prefix, and counting it as reserved would self-collide it to `_1` every time.
  const reservedTopLevelNames = collectReservedTopLevelNames(baseId, item.id)
  const { pathPrefix, children } = await expandDirectoryOwnerToTree(item, baseId, reservedTopLevelNames, signal)
  signal.throwIfAborted()

  if (children.length === 0) {
    logger.warn('Directory expansion produced no indexable files', {
      baseId,
      itemId: item.id,
      source: item.data.source
    })
    knowledgeItemService.updateStatus(item.id, 'failed', { error: EMPTY_DIRECTORY_ERROR })
    return []
  }

  // Pin the deduped `raw/` prefix the children were stored under onto the container, so the
  // UI shows the on-disk name (e.g. `docs_2`) and delete can remove the whole shell by it.
  knowledgeItemService.updateDirectoryRelativePath(item.id, pathPrefix)

  return await createDirectoryChildren(baseId, item.id, children, signal)
}

/**
 * Top-level `raw/` segment of every name already occupied in the base — the set a
 * directory expansion must avoid when claiming its own basename. Each reserved
 * relativePath contributes its first segment: a bare file (`report.pdf`) or another
 * directory's namespace (`docs/sub/a.pdf` → `docs`). Runs inside the base mutation
 * lock, so the read-then-dedupe-then-write is free of concurrent expansions.
 */
function collectReservedTopLevelNames(baseId: string, excludeItemId?: string): Set<string> {
  const items = knowledgeItemService.getItemsByBaseId(baseId)
  const names = new Set<string>()
  for (const relativePath of collectKnowledgeReservedRelativePaths(items, { excludeItemId })) {
    const topSegment = relativePath.split('/')[0]
    if (topSegment) {
      names.add(topSegment)
    }
  }
  return names
}

async function createDirectoryChildren(
  baseId: string,
  parentId: string,
  children: ExpandedDirectoryNode[],
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
      signal
    )
    const childLeafItems = await createDirectoryChildren(baseId, createdDirectory.id, child.children, signal)
    knowledgeItemService.updateStatus(createdDirectory.id, 'processing')
    leafItems.push(...childLeafItems)
  }

  return leafItems
}

async function createRuntimeItem<T extends KnowledgeItemType>(
  baseId: string,
  item: Extract<CreateKnowledgeItemDto, { type: T }>,
  signal: AbortSignal
): Promise<KnowledgeItemOf<T>> {
  signal.throwIfAborted()
  const createdItem = knowledgeItemService.create(baseId, item)

  const processingItem = isContainerKnowledgeItem(createdItem)
    ? knowledgeItemService.updateStatus(createdItem.id, 'preparing')
    : knowledgeItemService.updateStatus(createdItem.id, 'processing')
  signal.throwIfAborted()

  return processingItem as KnowledgeItemOf<T>
}
