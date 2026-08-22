/**
 * V1 Redux `assistants[].topics[]` is the authoritative conversation order.
 * `updatedAt` is recency, not the user-deliberate list.
 */

export interface V1TopicOrderSource {
  assistants?: Array<{ topics?: Array<{ id?: string | null }> | null }> | null
  defaultAssistant?: { topics?: Array<{ id?: string | null }> | null } | null
}

/**
 * Flatten topic ids from `assistants[]` then `defaultAssistant.topics[]`.
 * First write wins when the same id appears under more than one slot.
 */
export function collectV1TopicOrderIds(source: V1TopicOrderSource | null | undefined): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  const visit = (topics: Array<{ id?: string | null }> | null | undefined): void => {
    if (!Array.isArray(topics)) return
    for (const topic of topics) {
      const id = topic?.id
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }

  if (source?.assistants) {
    for (const assistant of source.assistants) {
      visit(assistant?.topics)
    }
  }
  visit(source?.defaultAssistant?.topics)
  return ids
}

/** Dexie-only leftovers: recency then id, so the append is stable. */
export function compareTopicLeftoversByUpdatedAtThenId(
  a: { id: string; updatedAt: number },
  b: { id: string; updatedAt: number }
): number {
  const byUpdatedAt = b.updatedAt - a.updatedAt
  if (byUpdatedAt !== 0) return byUpdatedAt
  return a.id.localeCompare(b.id)
}

/**
 * Keep Redux flatten order for known ids, then append items the flatten
 * never named, using `compareLeftovers`.
 */
export function orderItemsByV1TopicSequence<T>(
  items: readonly T[],
  getId: (item: T) => string,
  reduxOrderIds: readonly string[],
  compareLeftovers: (a: T, b: T) => number
): T[] {
  const remaining = new Map<string, T>()
  for (const item of items) {
    remaining.set(getId(item), item)
  }

  const ordered: T[] = []
  for (const id of reduxOrderIds) {
    const item = remaining.get(id)
    if (!item) continue
    ordered.push(item)
    remaining.delete(id)
  }

  const leftovers = [...remaining.values()].sort(compareLeftovers)
  return [...ordered, ...leftovers]
}
