import type { PathReadability } from '@main/utils/file'
import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'

import { probeKnowledgeFile, probeKnowledgeSourcePath } from './pathStorage'

export type IndexableKnowledgeItem = KnowledgeItemOf<'file' | 'url' | 'note'>

export type ContainerKnowledgeItem = KnowledgeItemOf<'directory'>

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function isContainerKnowledgeItem(item: KnowledgeItem): item is ContainerKnowledgeItem {
  return item.type === 'directory'
}

/**
 * The subset of an indexable knowledge item needed to derive its index-store
 * material fields. The `Pick` is distributed per member so `type` and `data`
 * stay correlated (a single `Pick` over the union would collapse `data` to a bare
 * union and lose the file-only `relativePath` / `indexedRelativePath`). Shared by
 * the indexing job and the v1→v2 vector migrator so both stamp the material
 * identically (knowledge-technical-design.md §4.2).
 */
export type MaterialFieldSource =
  | Pick<KnowledgeItemOf<'file'>, 'id' | 'type' | 'data'>
  | Pick<KnowledgeItemOf<'url'>, 'id' | 'type' | 'data'>
  | Pick<KnowledgeItemOf<'note'>, 'id' | 'type' | 'data'>

/**
 * A material's stable relative path. A file uses its stored path (the processed
 * artifact when present). A url or note uses its captured snapshot path — a real
 * base file under `raw/`, materialized before the material is stamped (the index
 * job's ensure-snapshot step, or the vector migrator), so it is always present
 * here; a missing one is an invariant violation, not a fallback case.
 */
export function toMaterialRelativePath(item: MaterialFieldSource): string {
  if (item.type === 'file') {
    return item.data.indexedRelativePath ?? item.data.relativePath
  }
  if (!item.data.relativePath) {
    throw new Error(`Knowledge ${item.type} item ${item.id} has no captured snapshot relativePath for its material`)
  }
  return item.data.relativePath
}

/** Whether a knowledge item's rebuild source is present, genuinely gone, or merely unverifiable. */
export type KnowledgeItemSourceState = 'rebuildable' | 'missing' | 'unverifiable'

const toSourceState = (probe: PathReadability): KnowledgeItemSourceState =>
  probe === 'readable' ? 'rebuildable' : probe

/**
 * Classify a knowledge item's rebuild source: a directory from its original folder (`data.source`), a
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
    return toSourceState(await probeKnowledgeSourcePath(item.data.source))
  }
  if (item.type === 'file') {
    return toSourceState(await probeKnowledgeFile(baseId, toMaterialRelativePath(item)))
  }
  return 'rebuildable'
}

/**
 * Whether a knowledge item can rebuild from a still-readable source. Gates reindex both at admission
 * (`KnowledgeIngestionService.assertSubtreesCanReindex`) and inside the reindex job's mutation lock right
 * before the delete — a vanished or unverifiable source must never wipe vectors with nothing to
 * rebuild from. Admission additionally distinguishes the two via {@link classifyKnowledgeItemSource}.
 */
export async function canKnowledgeItemRebuildSource(baseId: string, item: KnowledgeItem): Promise<boolean> {
  return (await classifyKnowledgeItemSource(baseId, item)) === 'rebuildable'
}
