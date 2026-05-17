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
  let lastCompletedThinkingBlockId: string | null = null
  let thinkingPrefix = ''

  return {
    // 获取当前思考时间（用于停止回复时保留思考时间）
    getCurrentThinkingInfo: () => ({
      blockId: thinkingBlockId,
      millsec: thinking_millsec_now > 0 ? performance.now() - thinking_millsec_now : 0
    }),

    onThinkingStart: async () => {
      // Set the start time immediately before any async operations to prevent a race condition
      // where onThinkingChunk fires while handleBlockTransition is still awaiting, causing
      // thinking_millsec to be computed as `performance.now() - 0` (a huge value).
      thinking_millsec_now = performance.now()

      if (blockManager.hasInitialPlaceholder) {
        const changes: Partial<MessageBlock> = {
          type: MessageBlockType.THINKING,
          content: '',
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: 0
        }
        thinkingBlockId = blockManager.initialPlaceholderBlockId!
        lastCompletedThinkingBlockId = null
        thinkingPrefix = ''
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
      } else if (
        !thinkingBlockId &&
        blockManager.lastBlockType === MessageBlockType.THINKING &&
        lastCompletedThinkingBlockId
      ) {
        thinkingBlockId = lastCompletedThinkingBlockId
        blockManager.smartBlockUpdate(
          thinkingBlockId,
          {
            status: MessageBlockStatus.STREAMING,
            thinking_millsec: 0
          },
          MessageBlockType.THINKING
        )
      } else if (!thinkingBlockId) {
        const newBlock = createThinkingBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: 0
        })
        thinkingBlockId = newBlock.id
        lastCompletedThinkingBlockId = null
        thinkingPrefix = ''
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.THINKING)
      }
    },

    onThinkingChunk: async (text: string) => {
      if (thinkingBlockId) {
        const blockChanges: Partial<MessageBlock> = {
          content: thinkingPrefix + text,
          status: MessageBlockStatus.STREAMING,
          thinking_millsec: thinking_millsec_now > 0 ? performance.now() - thinking_millsec_now : 0
        }
        blockManager.smartBlockUpdate(thinkingBlockId, blockChanges, MessageBlockType.THINKING)
      }
    },

    onThinkingComplete: (finalText: string) => {
      if (thinkingBlockId) {
        const now = performance.now()
        const content = thinkingPrefix + finalText
        const changes: Partial<MessageBlock> = {
          content,
          status: MessageBlockStatus.SUCCESS,
          thinking_millsec: now - thinking_millsec_now
        }
        blockManager.smartBlockUpdate(thinkingBlockId, changes, MessageBlockType.THINKING, true)
        lastCompletedThinkingBlockId = thinkingBlockId
        thinkingPrefix = content
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
