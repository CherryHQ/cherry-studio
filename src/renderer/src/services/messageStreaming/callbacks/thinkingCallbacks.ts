import { loggerService } from '@logger'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createThinkingBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ThinkingCallbacks')
interface ThinkingCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createThinkingCallbacks = (deps: ThinkingCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let thinkingBlockId: string | null = null
  let thinking_millsec_now: number = 0

  return {
    // 获取当前思考时间（用于停止回复时保留思考时间）
    getCurrentThinkingInfo: () => ({
      blockId: thinkingBlockId,
      millsec: thinking_millsec_now > 0 ? performance.now() - thinking_millsec_now : 0
    }),

    onThinkingStart: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const changes: Partial<MessageBlock> = {
          type: MessageBlockType.THINKING,
          content: '',
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: 0
        }
        thinkingBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
      } else if (!thinkingBlockId) {
        const newBlock = createThinkingBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: 0
        })
        thinkingBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.THINKING)
      }
      thinking_millsec_now = performance.now()
    },

    onThinkingChunk: async (text: string) => {
      if (thinkingBlockId) {
        const blockChanges: Partial<MessageBlock> = {
          content: text,
          status: MessageBlockStatus.STREAMING
          // thinking_millsec: performance.now() - thinking_millsec_now
        }
        blockManager.smartBlockUpdate(thinkingBlockId, blockChanges, MessageBlockType.THINKING)
      }
    },

    onThinkingComplete: (finalText: string) => {
      if (thinkingBlockId) {
        const now = performance.now()
        const changes: Partial<MessageBlock> = {
          content: finalText,
          status: MessageBlockStatus.SUCCESS,
          thinking_millsec: now - thinking_millsec_now
        }
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
        thinkingBlockId = null
        thinking_millsec_now = 0
      } else {
        logger.warn(
          `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
