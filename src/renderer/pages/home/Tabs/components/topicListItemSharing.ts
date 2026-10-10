import { isEqual } from 'es-toolkit/compat'

import { mapApiTopicToRendererTopic } from '@renderer/hooks/useTopic'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import type { Topic as ApiTopic } from '@shared/data/types/topic'

interface TopicListItemSnapshot {
  entity: ApiTopic
  item: RendererTopic
}

export interface TopicListItemReconciliation {
  items: readonly RendererTopic[]
  snapshots: ReadonlyMap<string, TopicListItemSnapshot>
}

export const EMPTY_TOPIC_LIST_ITEM_RECONCILIATION: TopicListItemReconciliation = {
  items: [],
  snapshots: new Map()
}

/**
 * Adds list-only pin state while preserving the item reference for unchanged topics.
 *
 * DataApi refreshes may replace the topics array when only one entity changed.
 * Reusing the remaining derived items keeps memoized rows isolated from that update.
 */
export function reconcileTopicListItems(
  topics: readonly ApiTopic[],
  isPinned: (id: string) => boolean,
  previous: TopicListItemReconciliation = EMPTY_TOPIC_LIST_ITEM_RECONCILIATION
): TopicListItemReconciliation {
  const nextSnapshots = new Map<string, TopicListItemSnapshot>()
  const nextItems: RendererTopic[] = []
  let itemsChanged = previous.items.length !== topics.length

  for (let index = 0; index < topics.length; index++) {
    const entity = topics[index]
    const pinned = isPinned(entity.id)
    const previousSnapshot = previous.snapshots.get(entity.id)
    const canReuse =
      previousSnapshot !== undefined &&
      previousSnapshot.item.pinned === pinned &&
      (previousSnapshot.entity === entity || isEqual(previousSnapshot.entity, entity))
    const snapshot = canReuse
      ? previousSnapshot
      : {
          entity,
          item: { ...mapApiTopicToRendererTopic(entity), pinned }
        }

    nextSnapshots.set(entity.id, snapshot)
    nextItems.push(snapshot.item)
    itemsChanged ||= snapshot.item !== previous.items[index]
  }

  if (!itemsChanged) return previous

  return {
    items: nextItems,
    snapshots: nextSnapshots
  }
}
