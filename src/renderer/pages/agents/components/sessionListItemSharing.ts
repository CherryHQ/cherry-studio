import { isEqual } from 'es-toolkit/compat'

import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

interface SessionListItemSnapshot {
  entity: AgentSessionEntity
  item: SessionListItem
}

export interface SessionListItemReconciliation {
  items: readonly SessionListItem[]
  snapshots: ReadonlyMap<string, SessionListItemSnapshot>
}

export const EMPTY_SESSION_LIST_ITEM_RECONCILIATION: SessionListItemReconciliation = {
  items: [],
  snapshots: new Map()
}

/**
 * Adds list-only state while preserving the item reference for unchanged sessions.
 *
 * DataApi refreshes may return fresh entity objects even when their content is unchanged.
 * Reusing the previous derived item keeps memoized rows isolated from unrelated list and pin updates.
 */
export function reconcileSessionListItems(
  sessions: readonly AgentSessionEntity[],
  pinIdBySessionId: ReadonlyMap<string, string>,
  previous: SessionListItemReconciliation = EMPTY_SESSION_LIST_ITEM_RECONCILIATION
): SessionListItemReconciliation {
  const nextSnapshots = new Map<string, SessionListItemSnapshot>()
  const nextItems: SessionListItem[] = []
  let itemsChanged = previous.items.length !== sessions.length

  for (let index = 0; index < sessions.length; index++) {
    const entity = sessions[index]
    const pinned = pinIdBySessionId.has(entity.id)
    const previousSnapshot = previous.snapshots.get(entity.id)
    const canReuse =
      previousSnapshot !== undefined &&
      previousSnapshot.item.pinned === pinned &&
      (previousSnapshot.entity === entity || isEqual(previousSnapshot.entity, entity))
    const snapshot = canReuse
      ? previousSnapshot
      : {
          entity,
          item: { ...entity, pinned }
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
