import { BlockManager } from '@renderer/services/messageStreaming'
import { createToolCallbacks } from '@renderer/services/messageStreaming/callbacks/toolCallbacks'
import type { AppDispatch } from '@renderer/store'
import { deepResearchActions } from '@renderer/store/deepResearch'
import { MCPToolResponse } from '@types'

interface DeepResearchToolCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string

  dispatch: AppDispatch
  researchId: string
  taskId: string
}

export const createDeepResearchToolCallbacks = (deps: DeepResearchToolCallbacksDependencies) => {
  const { blockManager, assistantMsgId, dispatch, researchId, taskId } = deps

  const originalToolCallbacks = createToolCallbacks({
    blockManager,
    assistantMsgId
  })

  return {
    onToolCallPending: (toolResponse: MCPToolResponse) => {
      originalToolCallbacks.onToolCallPending(toolResponse)
    },

    onToolCallInProgress: (toolResponse: MCPToolResponse) => {
      originalToolCallbacks.onToolCallInProgress(toolResponse)
    },

    onToolCallComplete: (toolResponse: MCPToolResponse) => {
      if (toolResponse) {
        dispatch(
          deepResearchActions.updateResearcherTaskInfoSources({
            researchId,
            taskId,
            infoSource: toolResponse
          })
        )
      }

      originalToolCallbacks.onToolCallComplete(toolResponse)
    }
  }
}
