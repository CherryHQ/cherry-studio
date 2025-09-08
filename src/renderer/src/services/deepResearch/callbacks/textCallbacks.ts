import { loggerService } from '@logger'
import { BlockManager } from '@renderer/services/messageStreaming'
import type { AppDispatch, RootState } from '@renderer/store'
import { deepResearchActions } from '@renderer/store/deepResearch'
import { WebSearchSource } from '@renderer/types'
import { CitationMessageBlock, MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'

const logger = loggerService.withContext('DeepResearchTextCallbacks')

interface DeepResearchTextCallbacksDependencies {
  // original deps
  blockManager: BlockManager
  getState: () => RootState
  assistantMsgId: string
  getCitationBlockId: () => string | null

  // new deps
  dispatch: AppDispatch
  researchId: string
  taskId: string
}

export const createDeepResearchTextCallbacks = (deps: DeepResearchTextCallbacksDependencies) => {
  const { blockManager, getState, assistantMsgId, getCitationBlockId, dispatch, researchId, taskId } = deps

  // 内部维护的状态
  let mainTextBlockId: string | null = null

  return {
    onTextStart: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const block = getState().messageBlocks.entities[blockManager.initialPlaceholderBlockId!]
        const changes = {
          type: MessageBlockType.MAIN_TEXT,
          content: '',
          status: MessageBlockStatus.STREAMING,
          metadata: {
            ...block.metadata,
            DEEP_RESEARCH_PRODUCED: true
          }
        }
        mainTextBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MessageBlockType.MAIN_TEXT, true)
      } else if (!mainTextBlockId) {
        const newBlock = createMainTextBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING,
          metadata: {
            DEEP_RESEARCH_PRODUCED: true
          }
        })
        mainTextBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
      }
    },
    onTextChunk: async (text: string) => {
      const citationBlockId = getCitationBlockId()
      const citationBlockSource = citationBlockId
        ? (getState().messageBlocks.entities[citationBlockId] as CitationMessageBlock).response?.source
        : WebSearchSource.WEBSEARCH
      if (text) {
        const blockChanges: Partial<MessageBlock> = {
          content: text,
          status: MessageBlockStatus.STREAMING,
          citationReferences: citationBlockId ? [{ citationBlockId, citationBlockSource }] : []
        }
        blockManager.smartBlockUpdate(mainTextBlockId!, blockChanges, MessageBlockType.MAIN_TEXT)
      }
    },
    onTextComplete: async (finalText: string) => {
      if (finalText) {
        const task = getState().deepResearch.researches[researchId]?.researcherTasks[taskId]
        dispatch(
          deepResearchActions.updateResearcherTask({
            researchId,
            taskId,
            updates: { rawResult: `${task?.rawResult ? task.rawResult + '\n' : ''}${finalText}` }
          })
        )
      }

      if (mainTextBlockId) {
        const changes = {
          content: finalText,
          status: MessageBlockStatus.SUCCESS
        }
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MessageBlockType.MAIN_TEXT, true)
        mainTextBlockId = null
      } else {
        logger.warn(
          `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
