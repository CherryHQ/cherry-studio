import path from 'node:path'

import {
  getKnowledgeItemConflictKey,
  getKnowledgeItemDisplayTitle,
  type KnowledgeAddItemConflict,
  type KnowledgeAddItemInput,
  type KnowledgeItem
} from '@shared/data/types/knowledge'
import { sanitizeFilename } from '@shared/utils/file'

export interface KnowledgeAddConflictResolution {
  /**
   * One entry per distinct same-name collision (deduped by type + detection key).
   * `title` is the existing colliding item's display name when the collision is
   * against an existing root, else the incoming source's display name (in-batch
   * collision). Used by the `detect` pass to populate the conflict dialog.
   */
  conflicts: KnowledgeAddItemConflict[]
  /** Existing root item ids whose name an incoming (kept) source collides with — the `replace` purge targets. */
  conflictingExistingRootIds: string[]
  /**
   * Inputs after in-batch last-wins dedup: when two incoming sources share a
   * type + detection key, only the last is kept (earlier ones are dropped). Used
   * as the add set for `replace`.
   */
  keptInputs: KnowledgeAddItemInput[]
}

/**
 * Detection key for one item, keyed on the `raw/` slot it occupies rather than the name it
 * was imported under: an incoming `CON.txt` has to match the `_.txt` the storage layer is
 * about to give it, or the duplicate goes undetected and lands beside it as `__1.txt`.
 *
 * file/directory are resolved here instead of in {@link getKnowledgeItemConflictKey} because
 * only the host knows whether a `\` in `data.source` separates directories (Windows) or is
 * part of one filename (POSIX) — and that is exactly what `getKnowledgeSourceRelativePath`
 * and `chooseDirectoryPathPrefix` decide with `path.basename` on the storage side. Stored
 * `relativePath`s are always `/`-separated, so they take the POSIX reading unconditionally.
 */
function knowledgeSlotConflictKey(item: KnowledgeItem | KnowledgeAddItemInput): string {
  if (item.type !== 'file' && item.type !== 'directory') {
    return getKnowledgeItemConflictKey(item)
  }
  const data = item.data as { relativePath?: string; source?: string }
  const name = data.relativePath ? path.posix.basename(data.relativePath) : path.basename(data.source ?? '')
  return sanitizeFilename(name)
}

// Combine the item type with its per-type detection key into a single map key.
// A NUL separator cannot appear in a type enum word, so distinct (type, key)
// pairs never alias.
const toConflictMapKey = (type: KnowledgeItem['type'], detectionKey: string): string => `${type}\0${detectionKey}`

/**
 * Resolve same-name conflicts for an `addItems` batch against the base's existing
 * root items. Pure: detection keys are derived via {@link knowledgeSlotConflictKey}
 * (per-type, intentionally distinct from the display title), and the scope is the
 * existing roots plus earlier items in the same batch.
 */
export function resolveKnowledgeAddConflicts(
  inputs: KnowledgeAddItemInput[],
  existingRoots: KnowledgeItem[]
): KnowledgeAddConflictResolution {
  // Existing roots grouped by detection key. With relativePath-based keys each
  // kept copy has a unique key (`test.md` / `test_2.md` / ...), so a group normally
  // holds exactly one root and `replace` targets only the matching copy; the array
  // still lets `replace` purge every root under a key should data ever duplicate one.
  const existingByKey = new Map<string, KnowledgeItem[]>()
  for (const item of existingRoots) {
    const detectionKey = knowledgeSlotConflictKey(item)
    // An empty detection key (e.g. a blank-content note) is not a real name and
    // must never collide — skip it entirely.
    if (detectionKey === '') {
      continue
    }
    const mapKey = toConflictMapKey(item.type, detectionKey)
    const group = existingByKey.get(mapKey)
    if (group) {
      group.push(item)
    } else {
      existingByKey.set(mapKey, [item])
    }
  }

  const conflictsByKey = new Map<string, KnowledgeAddItemConflict>()
  const conflictingExistingRootIds = new Set<string>()
  const seenBatchKeys = new Set<string>()
  const lastInputIndexByKey = new Map<string, number>()

  inputs.forEach((input, index) => {
    const detectionKey = knowledgeSlotConflictKey(input)
    // Empty-key inputs (blank-content notes) never collide and never dedup in-batch.
    if (detectionKey === '') {
      return
    }
    const mapKey = toConflictMapKey(input.type, detectionKey)
    const existing = existingByKey.get(mapKey)
    const collides = existing !== undefined || seenBatchKeys.has(mapKey)

    if (collides && !conflictsByKey.has(mapKey)) {
      conflictsByKey.set(mapKey, {
        type: input.type,
        // First existing item per key gives a stable display title.
        title: getKnowledgeItemDisplayTitle(existing?.[0] ?? input)
      })
    }
    if (existing) {
      for (const item of existing) {
        conflictingExistingRootIds.add(item.id)
      }
    }

    seenBatchKeys.add(mapKey)
    lastInputIndexByKey.set(mapKey, index)
  })

  const keptInputs = inputs.filter((input, index) => {
    const detectionKey = knowledgeSlotConflictKey(input)
    // Empty-key inputs are always kept — they never participate in dedup.
    if (detectionKey === '') {
      return true
    }
    const mapKey = toConflictMapKey(input.type, detectionKey)
    return lastInputIndexByKey.get(mapKey) === index
  })

  return {
    conflicts: [...conflictsByKey.values()],
    conflictingExistingRootIds: [...conflictingExistingRootIds],
    keptInputs
  }
}
