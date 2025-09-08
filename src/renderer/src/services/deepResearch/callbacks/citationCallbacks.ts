import { loggerService } from '@logger'
import { BlockManager } from '@renderer/services/messageStreaming'
import { createCitationCallbacks } from '@renderer/services/messageStreaming/callbacks/citationCallbacks'
import type { AppDispatch, RootState } from '@renderer/store'
import { deepResearchActions } from '@renderer/store/deepResearch'
import type { ExternalToolResult, WebSearchResponse } from '@renderer/types'

const logger = loggerService.withContext('DeepResearchCitationCallbacks')

interface DeepResearchCitationCallbacksDependencies {
  dispatch: AppDispatch
  getState: () => RootState
  researchId: string
  taskId: string
  blockManager: BlockManager
  assistantMsgId: string
}

export const createDeepResearchCitationCallbacks = (deps: DeepResearchCitationCallbacksDependencies) => {
  const { dispatch, getState, researchId, taskId, blockManager, assistantMsgId } = deps

  const originalCitationCallbacks = createCitationCallbacks({
    blockManager,
    assistantMsgId,
    getState
  })

  return {
    onExternalToolInProgress: async () => {
      await originalCitationCallbacks.onLLMWebSearchInProgress()
    },

    onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
      const task = getState().deepResearch.researches[researchId]?.researcherTasks[taskId]
      if (!task) {
        logger.warn(`Task with ID ${taskId} not found in research ${researchId}.`)
        return
      }
      const infoSources = [
        ...task.infoSources,
        ...(externalToolResult.webSearch ? [externalToolResult.webSearch] : []),
        ...(externalToolResult.knowledge ?? [])
      ]
      dispatch(
        deepResearchActions.updateResearcherTask({
          researchId,
          taskId,
          updates: {
            infoSources: infoSources
          }
        })
      )
      originalCitationCallbacks.onExternalToolComplete(externalToolResult)
    },

    onLLMWebSearchInProgress: async () => {
      await originalCitationCallbacks.onLLMWebSearchInProgress()
    },

    onLLMWebSearchComplete: async (llmWebSearchResult: WebSearchResponse) => {
      const task = getState().deepResearch.researches[researchId]?.researcherTasks[taskId]
      if (!task || !llmWebSearchResult) {
        return
      }
      const infoSources = [...task.infoSources, llmWebSearchResult]
      dispatch(
        deepResearchActions.updateResearcherTask({
          researchId,
          taskId,
          updates: {
            infoSources: infoSources
          }
        })
      )
      logger.info("Updated task's infoSources with LLM web search result.")
      await originalCitationCallbacks.onLLMWebSearchComplete(llmWebSearchResult)
    },
    // 暴露给外部的方法，用于textCallbacks中获取citationBlockId
    getCitationBlockId: () => originalCitationCallbacks.getCitationBlockId()
  }
}
