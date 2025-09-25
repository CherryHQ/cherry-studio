import { loggerService } from '@logger'
import { MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createThinkingBlock } from '@renderer/utils/messageUtils/create'

import { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ThinkingCallbacks')
interface ThinkingCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createThinkingCallbacks = (deps: ThinkingCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let thinkingBlockId: string | null = null
  let _thinking_millsec = 0

  return {
    onThinkingStart: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const changes: Partial<MessageBlock> = {
          type: MessageBlockType.THINKING,
          content: '',
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: _thinking_millsec
        }
        thinkingBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
      } else if (!thinkingBlockId) {
        const newBlock = createThinkingBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: _thinking_millsec
        })
        thinkingBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.THINKING)
      }
    },

    onThinkingChunk: async (text: string, thinking_millsec?: number) => {
      _thinking_millsec = thinking_millsec || 0
      if (thinkingBlockId) {
        const blockChanges: Partial<MessageBlock> = {
          content: text,
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: _thinking_millsec
        }
        blockManager.smartBlockUpdate(thinkingBlockId, blockChanges, MessageBlockType.THINKING)
      }
    },

    onThinkingComplete: (finalText: string) => {
      if (thinkingBlockId) {
        const changes: Partial<MessageBlock> = {
          content: finalText,
          status: MessageBlockStatus.SUCCESS,
          thinking_millsec: _thinking_millsec
        }
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
        thinkingBlockId = null
        _thinking_millsec = 0
      } else {
        logger.warn(
          `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
