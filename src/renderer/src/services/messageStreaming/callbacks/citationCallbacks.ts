/**
 * @fileoverview Citation callbacks for handling web search and knowledge references
 *
 * This module provides callbacks for processing citation data during streaming:
 * - External tool citations (web search, knowledge)
 * - LLM-integrated web search citations
 *
 * ARCHITECTURE NOTE:
 * These callbacks now use StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 */

import { loggerService } from '@logger'
import type { ExternalToolResult } from '@renderer/types'
import type { CitationMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createCitationBlock } from '@renderer/utils/messageUtils/create'
import { findMainTextBlocks } from '@renderer/utils/messageUtils/find'

import type { BlockManager } from '../BlockManager'
import { streamingService } from '../StreamingService'

const logger = loggerService.withContext('CitationCallbacks')

/**
 * Dependencies required for citation callbacks
 *
 * NOTE: Simplified - removed getState since StreamingService handles state.
 */
interface CitationCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createCitationCallbacks = (deps: CitationCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let citationBlockId: string | null = null

  return {
    onExternalToolInProgress: async () => {
      // 避免创建重复的引用块
      if (citationBlockId) {
        logger.warn(`[onExternalToolInProgress] Citation block already exists: ${citationBlockId}`)
        return
      }
      const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
      citationBlockId = citationBlock.id
      await blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
    },

    onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
      if (citationBlockId) {
        const changes: Partial<CitationMessageBlock> = {
          response: externalToolResult.webSearch,
          knowledge: externalToolResult.knowledge,
          status: MessageBlockStatus.SUCCESS
        }
        blockManager.smartBlockUpdate(citationBlockId, changes, MessageBlockType.CITATION, true)
      } else {
        logger.error('[onExternalToolComplete] citationBlockId is null. Cannot update.')
      }
    },

    onLLMWebSearchInProgress: async () => {
      // 避免创建重复的引用块
      if (citationBlockId) {
        logger.warn(`[onLLMWebSearchInProgress] Citation block already exists: ${citationBlockId}`)
        return
      }
      if (blockManager.hasInitialPlaceholder) {
        // blockManager.lastBlockType = MessageBlockType.CITATION
        logger.debug(`blockManager.initialPlaceholderBlockId: ${blockManager.initialPlaceholderBlockId}`)
        citationBlockId = blockManager.initialPlaceholderBlockId!
        logger.debug(`citationBlockId: ${citationBlockId}`)

        const changes = {
          type: MessageBlockType.CITATION,
          status: MessageBlockStatus.PROCESSING
        }
        blockManager.smartBlockUpdate(citationBlockId, changes, MessageBlockType.CITATION)
      } else {
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
        citationBlockId = citationBlock.id
        await blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
      }
    },

    onLLMWebSearchComplete: async (llmWebSearchResult: any) => {
      const blockId = citationBlockId || blockManager.initialPlaceholderBlockId
      if (blockId) {
        const changes: Partial<CitationMessageBlock> = {
          type: MessageBlockType.CITATION,
          response: llmWebSearchResult,
          status: MessageBlockStatus.SUCCESS
        }
        blockManager.smartBlockUpdate(blockId, changes, MessageBlockType.CITATION, true)

        // Get message from StreamingService
        const message = streamingService.getMessage(assistantMsgId)
        if (message) {
          const existingMainTextBlocks = findMainTextBlocks(message)
          if (existingMainTextBlocks.length > 0) {
            const existingMainTextBlock = existingMainTextBlocks[0]
            const currentRefs = existingMainTextBlock.citationReferences || []
            const mainTextChanges = {
              citationReferences: [...currentRefs, { blockId, citationBlockSource: llmWebSearchResult.source }]
            }
            blockManager.smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MessageBlockType.MAIN_TEXT, true)
          }
        }

        if (blockManager.hasInitialPlaceholder) {
          citationBlockId = blockManager.initialPlaceholderBlockId
        }
      } else {
        const citationBlock = createCitationBlock(
          assistantMsgId,
          {
            response: llmWebSearchResult
          },
          {
            status: MessageBlockStatus.SUCCESS
          }
        )
        citationBlockId = citationBlock.id

        // Get message from StreamingService
        const message = streamingService.getMessage(assistantMsgId)
        if (message) {
          const existingMainTextBlocks = findMainTextBlocks(message)
          if (existingMainTextBlocks.length > 0) {
            const existingMainTextBlock = existingMainTextBlocks[0]
            const currentRefs = existingMainTextBlock.citationReferences || []
            const mainTextChanges = {
              citationReferences: [...currentRefs, { citationBlockId, citationBlockSource: llmWebSearchResult.source }]
            }
            blockManager.smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MessageBlockType.MAIN_TEXT, true)
          }
        }
        await blockManager.handleBlockTransition(citationBlock, MessageBlockType.CITATION)
      }
    },

    // 暴露给外部的方法，用于textCallbacks中获取citationBlockId
    getCitationBlockId: () => citationBlockId,

    // 暴露给外部的方法，用于 KnowledgeService 中设置 citationBlockId
    setCitationBlockId: (blockId: string) => {
      citationBlockId = blockId
    }
  }
}
