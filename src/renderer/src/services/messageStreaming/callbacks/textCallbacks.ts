import { loggerService } from '@logger'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { CitationMessageBlock, MessageBlock } from '@renderer/types/newMessage'
import { MESSAGE_BLOCK_STATUS, MESSAGE_BLOCK_TYPE } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('TextCallbacks')

interface TextCallbacksDependencies {
  blockManager: BlockManager
  getState: any
  assistantMsgId: string
  getCitationBlockId: () => string | null
  getCitationBlockIdFromTool: () => string | null
  handleCompactTextComplete?: (text: string, mainTextBlockId: string | null) => Promise<boolean>
}

export const createTextCallbacks = (deps: TextCallbacksDependencies) => {
  const {
    blockManager,
    getState,
    assistantMsgId,
    getCitationBlockId,
    getCitationBlockIdFromTool,
    handleCompactTextComplete
  } = deps

  // 内部维护的状态
  let mainTextBlockId: string | null = null

  return {
    getCurrentMainTextBlockId: () => mainTextBlockId,
    onTextStart: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const changes = {
          type: MESSAGE_BLOCK_TYPE.MAIN_TEXT,
          content: '',
          status: MESSAGE_BLOCK_STATUS.STREAMING
        }
        mainTextBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MESSAGE_BLOCK_TYPE.MAIN_TEXT, true)
      } else if (!mainTextBlockId) {
        const newBlock = createMainTextBlock(assistantMsgId, '', {
          status: MESSAGE_BLOCK_STATUS.STREAMING
        })
        mainTextBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MESSAGE_BLOCK_TYPE.MAIN_TEXT)
      }
    },

    onTextChunk: async (text: string) => {
      const citationBlockId = getCitationBlockId() || getCitationBlockIdFromTool()
      const citationBlockSource = citationBlockId
        ? (getState().messageBlocks.entities[citationBlockId] as CitationMessageBlock).response?.source
        : WEB_SEARCH_SOURCE.WEBSEARCH
      if (text) {
        const blockChanges: Partial<MessageBlock> = {
          content: text,
          status: MESSAGE_BLOCK_STATUS.STREAMING,
          citationReferences: citationBlockId ? [{ citationBlockId, citationBlockSource }] : []
        }
        blockManager.smartBlockUpdate(mainTextBlockId!, blockChanges, MESSAGE_BLOCK_TYPE.MAIN_TEXT)
      }
    },

    onTextComplete: async (finalText: string) => {
      if (mainTextBlockId) {
        const changes = {
          content: finalText,
          status: MESSAGE_BLOCK_STATUS.SUCCESS
        }
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MESSAGE_BLOCK_TYPE.MAIN_TEXT, true)
        if (handleCompactTextComplete) {
          await handleCompactTextComplete(finalText, mainTextBlockId)
        }
        mainTextBlockId = null
      } else {
        logger.warn(
          `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
