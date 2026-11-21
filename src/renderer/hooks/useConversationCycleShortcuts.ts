import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { type CycleableConversation, getAdjacentConversation } from '@renderer/utils/conversationCycle'

interface Options<T extends CycleableConversation> {
  conversations: readonly T[]
  activeId: string | null | undefined
  onSelect: (conversation: T) => void
}

/** Binds the next/previous conversation shortcuts for the active tab's conversation list. */
export function useConversationCycleShortcuts<T extends CycleableConversation>({
  conversations,
  activeId,
  onSelect
}: Options<T>): void {
  const isActiveTab = useIsActiveTab()

  const cycle = (direction: 'next' | 'prev') => {
    const target = getAdjacentConversation(conversations, activeId, direction)
    if (target) onSelect(target)
  }

  useCommandHandler('chat.conversation.next', () => cycle('next'), { enabled: isActiveTab })
  useCommandHandler('chat.conversation.prev', () => cycle('prev'), { enabled: isActiveTab })
}
