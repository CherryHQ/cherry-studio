import type { PathReadability } from '@main/utils/file/fs'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { ContainerKnowledgeItem, IndexableKnowledgeItem } from '../types/items'
import { probeKnowledgeFile, probeKnowledgeSourcePath } from './storage/pathStorage'

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function filterIndexableKnowledgeItems(items: KnowledgeItem[]): IndexableKnowledgeItem[] {
  return items.filter(isIndexableKnowledgeItem)
}

export function isContainerKnowledgeItem(item: KnowledgeItem): item is ContainerKnowledgeItem {
  return item.type === 'directory'
}

/** Whether a knowledge item's rebuild source is present, genuinely gone, or merely unverifiable. */
export type KnowledgeItemSourceState = 'rebuildable' | 'missing' | 'unverifiable'

const toSourceState = (probe: PathReadability): KnowledgeItemSourceState =>
  probe === 'readable' ? 'rebuildable' : probe

/**
 * Classify a knowledge item's rebuild source: a directory from its original folder (`data.path`), a
 * file leaf from its own material file (`indexedRelativePath ?? relativePath`); note/url always
 * rebuild from the DB / network. The `unverifiable` state (a transient/permission error rather than
 * a genuine ENOENT) lets the admission gate avoid telling the user to delete a source that may still
 * exist. Reindex deletes a subtree's vectors before re-reading, so neither `missing` nor
 * `unverifiable` may proceed — both would wipe vectors with nothing to rebuild from.
 */
export async function classifyKnowledgeItemSource(
  baseId: string,
  item: KnowledgeItem
): Promise<KnowledgeItemSourceState> {
  if (item.type === 'directory') {
    return toSourceState(await probeKnowledgeSourcePath(item.data.path))
  }
  if (item.type === 'file') {
    return toSourceState(await probeKnowledgeFile(baseId, item.data.indexedRelativePath ?? item.data.relativePath))
  }
  return 'rebuildable'
}

/**
 * Whether a knowledge item can rebuild from a still-readable source. Gates reindex both at admission
 * (`KnowledgeService.assertSubtreesCanReindex`) and inside the reindex job's mutation lock right
 * before the delete — a vanished or unverifiable source must never wipe vectors with nothing to
 * rebuild from. Admission additionally distinguishes the two via {@link classifyKnowledgeItemSource}.
 */
export async function canKnowledgeItemRebuildSource(baseId: string, item: KnowledgeItem): Promise<boolean> {
  return (await classifyKnowledgeItemSource(baseId, item)) === 'rebuildable'
}
