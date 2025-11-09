import { loggerService } from '@logger'
import type { AppDispatch, RootState } from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { ClaudeCodeRawValue } from '@shared/agents/claudecode/types'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('CompactCallbacks')

interface CompactCallbacksDeps {
  blockManager: BlockManager
  assistantMsgId: string
  dispatch: AppDispatch
  getState: () => RootState
  topicId: string
  saveUpdatesToDB: any
}

interface CompactState {
  compactBoundaryDetected: boolean
  summaryBlockId: string | null
  isFirstBlockAfterCompact: boolean
  summaryText: string
}

export const createCompactCallbacks = (deps: CompactCallbacksDeps) => {
  const { blockManager, assistantMsgId, dispatch, getState, topicId, saveUpdatesToDB } = deps

  // State to track compact command processing
  const compactState: CompactState = {
    compactBoundaryDetected: false,
    summaryBlockId: null,
    isFirstBlockAfterCompact: false,
    summaryText: ''
  }

  /**
   * Extracts content from <local-command-stdout> XML tags
   */
  const extractCompactedContent = (text: string): string => {
    const match = text.match(/<local-command-(stdout|stderr)>(.*?)<\/local-command-(stdout|stderr)>/s)
    return match ? match[1].trim() : ''
  }

  /**
   * Checks if text contains local-command-stdout tags
   */
  const hasCompactedContent = (text: string): boolean => {
    return /<local-command-(stdout|stderr)>.*?<\/local-command-(stdout|stderr)>/s.test(text)
  }

  /**
   * Called when raw data is received from the stream
   */
  const onRawData = (content: unknown, metadata?: Record<string, any>) => {
    logger.debug('Raw data received', { content, metadata })

    const rawValue = content as ClaudeCodeRawValue

    // Check if this is a compact_boundary message
    if (rawValue.type === 'compact') {
      logger.info('Compact boundary detected')
      compactState.compactBoundaryDetected = true
      compactState.summaryBlockId = null
      compactState.isFirstBlockAfterCompact = true
      compactState.summaryText = ''
    }
  }

  /**
   * Intercept text complete to detect compacted content and create compact block
   */
  const handleTextComplete = async (text: string, currentMainTextBlockId: string | null) => {
    if (!compactState.compactBoundaryDetected || !currentMainTextBlockId) {
      return false
    }

    // Get the current main text block to check its full content
    const state = getState()
    const currentBlock = state.messageBlocks.entities[currentMainTextBlockId] as MainTextMessageBlock | undefined

    if (!currentBlock) {
      return false
    }

    const fullContent = currentBlock.content || text

    // First block after compact_boundary: This is the summary
    if (compactState.isFirstBlockAfterCompact) {
      logger.info('Detected first block after compact boundary (summary)', { fullContent })

      // Store the summary text and block ID
      compactState.summaryText = fullContent
      compactState.summaryBlockId = currentMainTextBlockId
      compactState.isFirstBlockAfterCompact = false

      // Hide this block by marking it as a placeholder temporarily
      // We'll convert it to compact block when we get the second block
      dispatch(
        updateOneBlock({
          id: currentMainTextBlockId,
          changes: {
            status: MessageBlockStatus.PROCESSING
          }
        })
      )

      return true // Prevent normal text block completion
    }

    // Second block after compact_boundary: Should contain the XML tags
    if (compactState.summaryBlockId && hasCompactedContent(fullContent)) {
      logger.info('Detected second block with compacted content', { fullContent })

      const compactedContent = extractCompactedContent(fullContent)
      const summaryBlockId = compactState.summaryBlockId

      logger.info('Converting summary block to compact block', {
        summaryText: compactState.summaryText,
        compactedContent,
        summaryBlockId
      })

      // Update the summary block to compact type
      dispatch(
        updateOneBlock({
          id: summaryBlockId,
          changes: {
            type: MessageBlockType.COMPACT,
            content: compactState.summaryText,
            compactedContent: compactedContent,
            status: MessageBlockStatus.SUCCESS
          }
        })
      )

      // Update block reference
      dispatch(
        newMessagesActions.upsertBlockReference({
          messageId: assistantMsgId,
          blockId: summaryBlockId,
          status: MessageBlockStatus.SUCCESS,
          blockType: MessageBlockType.COMPACT
        })
      )

      // Clear active block info and update lastBlockType since the compact block is now complete
      blockManager.activeBlockInfo = null
      blockManager.lastBlockType = MessageBlockType.COMPACT

      // Remove the current block (the one with XML tags) from message.blocks
      const currentState = getState()
      const currentMessage = currentState.messages.entities[assistantMsgId]
      if (currentMessage && currentMessage.blocks) {
        const updatedBlocks = currentMessage.blocks.filter((id) => id !== currentMainTextBlockId)
        dispatch(
          newMessagesActions.updateMessage({
            topicId,
            messageId: assistantMsgId,
            updates: { blocks: updatedBlocks }
          })
        )
      }

      // Save to DB
      const updatedState = getState()
      const updatedMessage = updatedState.messages.entities[assistantMsgId]
      const updatedBlock = updatedState.messageBlocks.entities[summaryBlockId]
      if (updatedMessage && updatedBlock) {
        await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks }, [updatedBlock])
      }

      // Reset compact state
      compactState.compactBoundaryDetected = false
      compactState.summaryBlockId = null
      compactState.summaryText = ''
      compactState.isFirstBlockAfterCompact = false

      return true
    }

    return false
  }

  return {
    onRawData,
    handleTextComplete
  }
}
