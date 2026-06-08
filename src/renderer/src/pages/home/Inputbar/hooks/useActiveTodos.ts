import { useAppSelector } from '@renderer/store'
import { type ActiveTodoInfo, selectActiveTodoInfo } from '@renderer/store/messageBlock'

export type { ActiveTodoInfo }

/**
 * Hook to get active todo info for a specific topic.
 * Returns the latest TodoWrite block's todos, or undefined if none exist.
 */
export const useActiveTodos = (topicId: string): ActiveTodoInfo | undefined =>
  useAppSelector((state) => selectActiveTodoInfo(state, topicId))
