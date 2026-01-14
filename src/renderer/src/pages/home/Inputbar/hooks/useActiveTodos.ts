import { useAppSelector } from '@renderer/store'
import { selectLatestTodoWriteBlockForTopic } from '@renderer/store/messageBlock'
import type { NormalToolResponse } from '@renderer/types'
import { useMemo } from 'react'

import type { TodoItem, TodoWriteToolInput } from '../../Messages/Tools/MessageAgentTools/types'

/**
 * Information about todos for PinnedTodoPanel
 */
export interface ActiveTodoInfo {
  /** Message block ID */
  blockId: string
  /** All todos */
  todos: TodoItem[]
  /** Number of completed todos */
  completedCount: number
  /** Total number of todos */
  totalCount: number
}

export function useActiveTodos(topicId: string): ActiveTodoInfo | undefined {
  const latestTodoBlock = useAppSelector((state) => selectLatestTodoWriteBlockForTopic(state, topicId))

  return useMemo((): ActiveTodoInfo | undefined => {
    if (!latestTodoBlock) return undefined

    const toolResponse = latestTodoBlock.metadata?.rawMcpToolResponse as NormalToolResponse
    const args = toolResponse?.arguments as TodoWriteToolInput | undefined
    const todos = args?.todos ?? []

    const completedCount = todos.filter((todo) => todo.status === 'completed').length
    const hasIncompleteTodos = todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress')

    if (!hasIncompleteTodos) return undefined

    return {
      blockId: latestTodoBlock.id,
      todos,
      completedCount,
      totalCount: todos.length
    }
  }, [latestTodoBlock])
}
