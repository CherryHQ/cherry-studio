/**
 * @fileoverview Text callbacks for handling main text block streaming
 *
 * This module provides callbacks for processing text content during streaming:
 * - Text start: initialize or transform placeholder to main text block
 * - Text chunk: update content during streaming
 * - Text complete: finalize the block
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 */

import { loggerService } from '@logger'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ProviderMetadata } from '@renderer/types/chunk'
import type { CitationMessageBlock, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'
import { streamingService } from '../StreamingService'

const logger = loggerService.withContext('TextCallbacks')

/**
 * Dependencies required for text callbacks
 *
 * NOTE: Simplified - removed getState since StreamingService handles state.
 */
interface TextCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
  getCitationBlockId: () => string | null
  getCitationBlockIdFromTool: () => string | null
  handleCompactTextComplete?: (text: string, mainTextBlockId: string | null) => Promise<boolean>
}

export const createTextCallbacks = (deps: TextCallbacksDependencies) => {
  const { blockManager, assistantMsgId, getCitationBlockId, getCitationBlockIdFromTool, handleCompactTextComplete } =
    deps

  // 内部维护的状态
  let mainTextBlockId: string | null = null
  // Track thoughtSignature for Gemini thought signature persistence
  let currentThoughtSignature: string | undefined

  return {
    getCurrentMainTextBlockId: () => mainTextBlockId,
    onTextStart: async () => {
      if (blockManager.hasInitialPlaceholder) {
        const changes = {
          type: MessageBlockType.MAIN_TEXT,
          content: '',
          status: MessageBlockStatus.STREAMING
        }
        mainTextBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MessageBlockType.MAIN_TEXT, true)
      } else if (!mainTextBlockId) {
        const newBlock = createMainTextBlock(assistantMsgId, '', {
          status: MessageBlockStatus.STREAMING
        })
        mainTextBlockId = newBlock.id
        await blockManager.handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
      }
    },

    onTextChunk: async (text: string, providerMetadata?: ProviderMetadata) => {
      const citationBlockId = getCitationBlockId() || getCitationBlockIdFromTool()
      // Get citation block from StreamingService to determine source
      const citationBlock = citationBlockId
        ? (streamingService.getBlock(citationBlockId) as CitationMessageBlock | null)
        : null
      const citationBlockSource = citationBlock?.response?.source ?? WEB_SEARCH_SOURCE.WEBSEARCH

      if (text) {
        const blockChanges: Partial<MessageBlock> = {
          content: text,
          status: MessageBlockStatus.STREAMING,
          citationReferences: citationBlockId ? [{ citationBlockId, citationBlockSource }] : []
        }
        blockManager.smartBlockUpdate(mainTextBlockId!, blockChanges, MessageBlockType.MAIN_TEXT)
      }
      // Collect thoughtSignature from providerMetadata for Gemini
      if (providerMetadata?.google?.thoughtSignature) {
        currentThoughtSignature = providerMetadata.google.thoughtSignature
      }
    },

    onTextComplete: async (finalText: string, providerMetadata?: ProviderMetadata) => {
      if (mainTextBlockId) {
        // Use thoughtSignature from providerMetadata if available, otherwise use collected one
        const thoughtSignature = providerMetadata?.google?.thoughtSignature || currentThoughtSignature
        const changes: Partial<MessageBlock> = {
          content: finalText,
          status: MessageBlockStatus.SUCCESS,
          // Store thoughtSignature in metadata for persistence
          metadata: thoughtSignature ? { thoughtSignature } : undefined
        }
        blockManager.smartBlockUpdate(mainTextBlockId, changes, MessageBlockType.MAIN_TEXT, true)
        if (handleCompactTextComplete) {
          await handleCompactTextComplete(finalText, mainTextBlockId)
        }
        // Clear thoughtSignature after block is complete
        currentThoughtSignature = undefined
        mainTextBlockId = null
      } else {
        logger.warn(
          `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${blockManager.lastBlockType}) or lastBlockId is null.`
        )
      }
    }
  }
}
