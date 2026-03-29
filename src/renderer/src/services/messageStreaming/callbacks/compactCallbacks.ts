/**
 * @fileoverview Compact callbacks for handling /compact command responses
 *
 * This module provides callbacks for processing compact command responses
 * from Claude Code. It detects compact_boundary messages and creates
 * compact blocks that contain both summary and compacted content.
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 *
 * Key changes:
 * - dispatch/getState replaced with streamingService methods
 * - saveUpdatesToDB removed (handled by finalize)
 */

import { loggerService } from '@logger'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { ClaudeCodeRawValue } from '@shared/agents/claudecode/types'

import type { BlockManager } from '../BlockManager'
import { streamingService } from '../StreamingService'

const logger = loggerService.withContext('CompactCallbacks')

/**
 * Dependencies required for compact callbacks
 *
 * NOTE: Simplified from original design - removed dispatch, getState, and saveUpdatesToDB
 * since StreamingService now handles state management and persistence.
 */
interface CompactCallbacksDeps {
  blockManager: BlockManager
  assistantMsgId: string
  topicId: string
}

interface CompactState {
  compactBoundaryDetected: boolean
  summaryBlockId: string | null
  isFirstBlockAfterCompact: boolean
  summaryText: string
}

export const createCompactCallbacks = (deps: CompactCallbacksDeps) => {
  const { blockManager, assistantMsgId } = deps

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
    return match ? match[2].trim() : ''
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

    // Get the current main text block from StreamingService
    const currentBlock = streamingService.getBlock(currentMainTextBlockId) as MainTextMessageBlock | null

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
      streamingService.updateBlock(currentMainTextBlockId, {
        status: MessageBlockStatus.PROCESSING
      })

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
      streamingService.updateBlock(summaryBlockId, {
        type: MessageBlockType.COMPACT,
        content: compactState.summaryText,
        compactedContent: compactedContent,
        status: MessageBlockStatus.SUCCESS
      } as any) // Using 'as any' for compactedContent which is specific to CompactMessageBlock

      // Clear active block info and update lastBlockType since the compact block is now complete
      blockManager.activeBlockInfo = null
      blockManager.lastBlockType = MessageBlockType.COMPACT

      // Remove the current block (the one with XML tags) from message.blocks
      const currentMessage = streamingService.getMessage(assistantMsgId)
      if (currentMessage && currentMessage.blocks) {
        const updatedBlocks = currentMessage.blocks.filter((id) => id !== currentMainTextBlockId)
        streamingService.updateMessage(assistantMsgId, { blocks: updatedBlocks })
      }

      // NOTE: DB save is removed - will be handled by finalize()

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
