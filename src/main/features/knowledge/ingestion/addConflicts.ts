import {
  getKnowledgeItemConflictKey,
  getKnowledgeItemDisplayTitle,
  type KnowledgeAddItemConflict,
  type KnowledgeAddItemInput,
  type KnowledgeItem
} from '@shared/data/types/knowledge'

export interface KnowledgeAddConflictResolution {
  /**
   * What a `replace` would purge, disclosed for the conflict dialog: one entry per
   * existing root that collides with an incoming source, each with its own display
   * title. A source path kept multiple times ("保留全部") groups under one detection
   * key but contributes several entries (e.g. `test.md` and `test_2.md`), so the
   * dialog never hides a copy that replacement will delete. A collision that exists
   * only within the incoming batch (no existing root) contributes a single entry for
   * the incoming source. Populated by the `detect` pass.
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

// Combine the item type with its per-type detection key into a single map key.
// A NUL separator cannot appear in a type enum word, so distinct (type, key)
// pairs never alias.
const toConflictMapKey = (type: KnowledgeItem['type'], detectionKey: string): string => `${type}\0${detectionKey}`

/**
 * Resolve same-name conflicts for an `addItems` batch against the base's existing
 * root items. Pure: detection keys are derived via {@link getKnowledgeItemConflictKey}
 * (per-type, intentionally distinct from the display title), and the scope is the
 * existing roots plus earlier items in the same batch.
 */
export function resolveKnowledgeAddConflicts(
  inputs: KnowledgeAddItemInput[],
  existingRoots: KnowledgeItem[]
): KnowledgeAddConflictResolution {
  // Existing roots grouped by detection key. file/directory key off the original
  // source path, so a group holds one root per distinct path — usually one, but more
  // when the same path was kept multiple times; `replace` then purges every copy of
  // that path (the array lets it do so).
  const existingByKey = new Map<string, KnowledgeItem[]>()
  for (const item of existingRoots) {
    const detectionKey = getKnowledgeItemConflictKey(item)
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

  const conflictsByKey = new Map<string, KnowledgeAddItemConflict[]>()
  const conflictingExistingRootIds = new Set<string>()
  const seenBatchKeys = new Set<string>()
  const lastInputIndexByKey = new Map<string, number>()

  inputs.forEach((input, index) => {
    const detectionKey = getKnowledgeItemConflictKey(input)
    // Empty-key inputs (blank-content notes) never collide and never dedup in-batch.
    if (detectionKey === '') {
      return
    }
    const mapKey = toConflictMapKey(input.type, detectionKey)
    const existing = existingByKey.get(mapKey)
    const collides = existing !== undefined || seenBatchKeys.has(mapKey)

    if (collides && !conflictsByKey.has(mapKey)) {
      // Disclose exactly what `replace` will purge: one entry per existing copy sharing
      // this key (a path kept multiple times has several), each with its own title. An
      // in-batch-only collision has no existing copy — report the incoming source once.
      const entries: KnowledgeAddItemConflict[] =
        existing && existing.length > 0
          ? existing.map((item) => ({ type: input.type, title: getKnowledgeItemDisplayTitle(item) }))
          : [{ type: input.type, title: getKnowledgeItemDisplayTitle(input) }]
      conflictsByKey.set(mapKey, entries)
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
    const detectionKey = getKnowledgeItemConflictKey(input)
    // Empty-key inputs are always kept — they never participate in dedup.
    if (detectionKey === '') {
      return true
    }
    const mapKey = toConflictMapKey(input.type, detectionKey)
    return lastInputIndexByKey.get(mapKey) === index
  })

  return {
    conflicts: [...conflictsByKey.values()].flat(),
    conflictingExistingRootIds: [...conflictingExistingRootIds],
    keptInputs
  }
}
