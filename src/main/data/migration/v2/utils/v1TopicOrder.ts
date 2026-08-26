/**
 * V1 Redux `assistants[].topics[]` is the authoritative conversation order.
 * `updatedAt` is recency, not the user-deliberate list.
 */

export interface V1TopicOrderItem {
  id?: string | null
  pinned?: boolean | null
}

export interface V1TopicOrderSource {
  assistants?: Array<{ topics?: Array<V1TopicOrderItem> | null }> | null
  defaultAssistant?: { topics?: Array<V1TopicOrderItem> | null } | null
}

function collectFirstWriteV1Topics(
  source: V1TopicOrderSource | null | undefined
): Array<{ id: string; pinned: boolean }> {
  const items: Array<{ id: string; pinned: boolean }> = []
  const seen = new Set<string>()

  const visit = (topics: Array<V1TopicOrderItem> | null | undefined): void => {
    if (!Array.isArray(topics)) return
    for (const topic of topics) {
      const id = topic?.id
      if (!id || seen.has(id)) continue
      seen.add(id)
      items.push({ id, pinned: topic.pinned === true })
    }
  }

  if (source?.assistants) {
    for (const assistant of source.assistants) {
      visit(assistant?.topics)
    }
  }
  visit(source?.defaultAssistant?.topics)
  return items
}

/**
 * Flatten topic ids from `assistants[]` then `defaultAssistant.topics[]`.
 * First write wins when the same id appears under more than one slot.
 */
export function collectV1TopicOrderIds(source: V1TopicOrderSource | null | undefined): string[] {
  return collectFirstWriteV1Topics(source).map((item) => item.id)
}

/**
 * Same flatten, restricted to first-write `pinned === true`.
 * A later slot cannot pin (or unpin) an id already seen.
 */
export function collectV1PinnedTopicOrderIds(source: V1TopicOrderSource | null | undefined): string[] {
  return collectFirstWriteV1Topics(source)
    .filter((item) => item.pinned)
    .map((item) => item.id)
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
