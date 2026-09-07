import type { PathReadability } from '@main/utils/file'
import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { AbsoluteFilePathSchema } from '@shared/types/file'

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
 * Classify what a *restore* would copy out of this base: a file leaf's own material file
 * (`indexedRelativePath ?? relativePath`, copied into the new base), a directory's original folder
 * (`data.source`, rescanned by the new base); note/url carry their content or snapshot. The
 * `unverifiable` state (a transient/permission error rather than a genuine ENOENT) lets restore
 * avoid dropping a source it could not confirm is gone.
 *
 * Deliberately *not* the reindex question — see {@link classifyKnowledgeItemReacquireSource}. A file
 * whose original was deleted still restores perfectly from this base's copy.
 */
export async function classifyKnowledgeItemRestoreSource(
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
 * Classify what a *reindex* would re-acquire from: reindex is "re-acquire from the real source, then
 * rebuild", so a file and a directory are both probed at their original on-disk path (`data.source`)
 * — never at this base's copy, which is the thing being overwritten. A note re-acquires from
 * `data.content` and a url from the network, neither of which the filesystem can answer for.
 *
 * A `data.source` that is not even a well-formed absolute path (a v1 row carrying a stale or
 * cross-platform value) is reported `missing` rather than thrown: the user's remedy is the same
 * delete-and-re-add, and a raw parse error would surface as an opaque reindex failure instead.
 */
export async function classifyKnowledgeItemReacquireSource(item: KnowledgeItem): Promise<KnowledgeItemSourceState> {
  if (item.type !== 'file' && item.type !== 'directory') {
    return 'rebuildable'
  }
  if (!AbsoluteFilePathSchema.safeParse(item.data.source).success) {
    return 'missing'
  }
  return toSourceState(await probeKnowledgeSourcePath(item.data.source))
}

/**
 * Whether a knowledge item can re-acquire from a still-readable source. Gates reindex both at
 * admission (`KnowledgeIngestionService.assertSubtreesCanReindex`) and inside the reindex job's
 * mutation lock right before the delete — a vanished or unverifiable source must never wipe vectors
 * with nothing to rebuild from. Admission additionally distinguishes the two via
 * {@link classifyKnowledgeItemReacquireSource}.
 */
export async function canKnowledgeItemReacquireSource(item: KnowledgeItem): Promise<boolean> {
  return (await classifyKnowledgeItemReacquireSource(item)) === 'rebuildable'
}
