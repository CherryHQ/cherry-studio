import { useAppSelector } from '@renderer/store'
import { type ActiveTodoInfo, selectActiveTodoInfo } from '@renderer/store/messageBlock'

export type { ActiveTodoInfo }

/**
 * Hook to get active todo info for a specific topic.
 * Returns undefined if no TodoWrite block with incomplete todos exists.
 */
export const useActiveTodos = (topicId: string): ActiveTodoInfo | undefined =>
  useAppSelector((state) => selectActiveTodoInfo(state, topicId))
