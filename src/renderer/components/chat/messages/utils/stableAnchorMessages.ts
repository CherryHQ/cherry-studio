import type { AnchorMessage, MessageListItem } from '../types'

export interface StableAnchorMessagesCache {
  previous: AnchorMessage[]
}

export function createStableAnchorMessagesCache(): StableAnchorMessagesCache {
  return { previous: [] }
}

function sameTopology(previous: AnchorMessage, message: MessageListItem): boolean {
  return (
    previous.id === message.id &&
    previous.role === message.role &&
    previous.isActiveBranch === message.isActiveBranch &&
    previous.isContextBoundary === message.isContextBoundary
  )
}

/**
 * Project `messages` onto the anchor rail's topology, reusing the previous
 * array whenever that topology is unchanged.
 *
 * Every streaming chunk hands MessageList a fresh `messages` array — the live
 * assistant snapshot is rebuilt, and both `mergeMessagesById` and the adapter's
 * `map` allocate unconditionally — so without this projection the rail's `memo`
 * never bails and re-renders every tick per chunk. The comparison runs before
 * the projection is built, so the unchanged path allocates nothing.
 */
export function stableAnchorMessages(
  messages: readonly MessageListItem[],
  cache: StableAnchorMessagesCache
): AnchorMessage[] {
  const previous = cache.previous
  if (
    previous.length === messages.length &&
    messages.every((message, index) => sameTopology(previous[index], message))
  ) {
    return previous
  }

  const next = messages.map((message) => ({
    id: message.id,
    role: message.role,
    isActiveBranch: message.isActiveBranch,
    isContextBoundary: message.isContextBoundary
  }))
  cache.previous = next
  return next
}
