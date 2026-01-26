import { useAppSelector } from '@renderer/store'
import { selectAllTodoWriteBlockIdsForTopic, selectLatestTodoWriteBlockForTopic } from '@renderer/store/messageBlock'
import type { NormalToolResponse } from '@renderer/types'
import { useMemo } from 'react'

import type { TodoItem, TodoWriteToolInput } from '../../Messages/Tools/MessageAgentTools/types'

/**
 * Information about todos for PinnedTodoPanel
 */
export interface ActiveTodoInfo {
  /** Message block ID */
  blockId: string
  /** Message ID that contains this block */
  messageId: string
  /** All todos */
  todos: TodoItem[]
  /** Number of completed todos */
  completedCount: number
  /** Total number of todos */
  totalCount: number
  /** All TodoWrite blocks in this topic (for deletion) */
  allTodoWriteBlocks: { blockId: string; messageId: string }[]
}

/**
 * Hook to get todos from the latest TodoWrite block for a specific topic
 * Returns undefined if no TodoWrite block with incomplete todos exists
 * (selector already guarantees the block has incomplete todos)
 */
export function useActiveTodos(topicId: string): ActiveTodoInfo | undefined {
  const latestTodoBlock = useAppSelector((state) => selectLatestTodoWriteBlockForTopic(state, topicId))
  const allTodoWriteBlocks = useAppSelector((state) => selectAllTodoWriteBlockIdsForTopic(state, topicId))

  return useMemo((): ActiveTodoInfo | undefined => {
    if (!latestTodoBlock) return undefined

    const toolResponse = latestTodoBlock.metadata?.rawMcpToolResponse as NormalToolResponse
    const args = toolResponse?.arguments as TodoWriteToolInput | undefined
    const todos = args?.todos ?? []

    return {
      blockId: latestTodoBlock.id,
      messageId: latestTodoBlock.messageId,
      todos,
      completedCount: todos.filter((todo) => todo.status === 'completed').length,
      totalCount: todos.length,
      allTodoWriteBlocks
    }
  }, [latestTodoBlock, allTodoWriteBlocks])
}
