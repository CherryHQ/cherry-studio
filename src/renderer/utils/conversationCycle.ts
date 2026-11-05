export interface CycleableConversation {
  id: string
  lastActivityAt: string
}

/**
 * Next (older) or previous (more recent) conversation by recency. The ends do not wrap.
 * An unknown active conversation steps onto the most recent one.
 */
export function getAdjacentConversation<T extends CycleableConversation>(
  conversations: readonly T[],
  activeId: string | null | undefined,
  direction: 'next' | 'prev'
): T | undefined {
  const ordered = [...conversations].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
  const activeIndex = ordered.findIndex((conversation) => conversation.id === activeId)
  if (activeIndex === -1) return direction === 'next' ? ordered[0] : undefined
  return ordered[activeIndex + (direction === 'next' ? 1 : -1)]
}
