import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { ContainerKnowledgeItem, IndexableKnowledgeItem } from '../types/items'
import { knowledgeFileExists, knowledgeSourcePathExists } from './storage/pathStorage'

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function filterIndexableKnowledgeItems(items: KnowledgeItem[]): IndexableKnowledgeItem[] {
  return items.filter(isIndexableKnowledgeItem)
}

export function isContainerKnowledgeItem(item: KnowledgeItem): item is ContainerKnowledgeItem {
  return item.type === 'directory'
}

/**
 * Whether a knowledge item can rebuild its content from a still-existing source: a directory from its
 * original folder (`data.path`), a file leaf from its own material file (`indexedRelativePath ??
 * relativePath`). note/url always rebuild from the DB / network. Reindex deletes a subtree's vectors
 * before re-reading, so this gates reindex both at admission (`KnowledgeService.assertSubtreesCanReindex`)
 * and inside the reindex job's mutation lock right before the delete — a vanished source must never wipe
 * vectors with nothing to rebuild from.
 */
export async function canKnowledgeItemRebuildSource(baseId: string, item: KnowledgeItem): Promise<boolean> {
  if (item.type === 'directory') {
    return knowledgeSourcePathExists(item.data.path)
  }
  if (item.type === 'file') {
    return knowledgeFileExists(baseId, item.data.indexedRelativePath ?? item.data.relativePath)
  }
  return true
}
