import { useAppSelector } from '@renderer/store'
import { selectLatestTodoWriteBlockForTopic } from '@renderer/store/messageBlock'
import type { NormalToolResponse } from '@renderer/types'
import { useMemo } from 'react'

import type { TodoItem, TodoWriteToolInput } from '../../Messages/Tools/MessageAgentTools/types'

/**
 * Information about active (incomplete) todos for PinnedTodoPanel
 */
export interface ActiveTodoInfo {
  /** Message block ID */
  blockId: string
  /** List of incomplete todos */
  incompleteTodos: TodoItem[]
  /** Number of completed todos */
  completedCount: number
  /** Total number of todos */
  totalCount: number
}

/**
 * Hook to get active (incomplete) todos from the latest TodoWrite block for a specific topic
 * Returns undefined if no incomplete todos exist
 */
export function useActiveTodos(topicId: string): ActiveTodoInfo | undefined {
  const latestTodoBlock = useAppSelector((state) => selectLatestTodoWriteBlockForTopic(state, topicId))

  return useMemo((): ActiveTodoInfo | undefined => {
    if (!latestTodoBlock) return undefined

    const toolResponse = latestTodoBlock.metadata?.rawMcpToolResponse as NormalToolResponse
    const args = toolResponse?.arguments as TodoWriteToolInput | undefined
    const todos = args?.todos ?? []

    const incompleteTodos = todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress')
    const completedCount = todos.filter((todo) => todo.status === 'completed').length

    // If no incomplete todos, return undefined
    if (incompleteTodos.length === 0) return undefined

    return {
      blockId: latestTodoBlock.id,
      incompleteTodos,
      completedCount,
      totalCount: todos.length
    }
  }, [latestTodoBlock])
}
