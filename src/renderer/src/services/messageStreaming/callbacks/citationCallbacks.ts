import { loggerService } from '@logger'
import type { ExternalToolResult } from '@renderer/types'
import type { CitationMessageBlock } from '@renderer/types/newMessage'
import { MESSAGE_BLOCK_STATUS, MESSAGE_BLOCK_TYPE } from '@renderer/types/newMessage'
import { createCitationBlock } from '@renderer/utils/messageUtils/create'
import { findMainTextBlocks } from '@renderer/utils/messageUtils/find'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('CitationCallbacks')

interface CitationCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
  getState: any
}

export const createCitationCallbacks = (deps: CitationCallbacksDependencies) => {
  const { blockManager, assistantMsgId, getState } = deps

  // 内部维护的状态
  let citationBlockId: string | null = null

  return {
    onExternalToolInProgress: async () => {
      // 避免创建重复的引用块
      if (citationBlockId) {
        logger.warn(`[onExternalToolInProgress] Citation block already exists: ${citationBlockId}`)
        return
      }
      const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MESSAGE_BLOCK_STATUS.PROCESSING })
      citationBlockId = citationBlock.id
      await blockManager.handleBlockTransition(citationBlock, MESSAGE_BLOCK_TYPE.CITATION)
    },

    onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
      if (citationBlockId) {
        const changes: Partial<CitationMessageBlock> = {
          response: externalToolResult.webSearch,
          knowledge: externalToolResult.knowledge,
          status: MESSAGE_BLOCK_STATUS.SUCCESS
        }
        blockManager.smartBlockUpdate(citationBlockId, changes, MESSAGE_BLOCK_TYPE.CITATION, true)
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
          type: MESSAGE_BLOCK_TYPE.CITATION,
          status: MESSAGE_BLOCK_STATUS.PROCESSING
        }
        blockManager.smartBlockUpdate(citationBlockId, changes, MESSAGE_BLOCK_TYPE.CITATION)
      } else {
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MESSAGE_BLOCK_STATUS.PROCESSING })
        citationBlockId = citationBlock.id
        await blockManager.handleBlockTransition(citationBlock, MESSAGE_BLOCK_TYPE.CITATION)
      }
    },

    onLLMWebSearchComplete: async (llmWebSearchResult: any) => {
      const blockId = citationBlockId || blockManager.initialPlaceholderBlockId
      if (blockId) {
        const changes: Partial<CitationMessageBlock> = {
          type: MESSAGE_BLOCK_TYPE.CITATION,
          response: llmWebSearchResult,
          status: MESSAGE_BLOCK_STATUS.SUCCESS
        }
        blockManager.smartBlockUpdate(blockId, changes, MESSAGE_BLOCK_TYPE.CITATION, true)

        const state = getState()
        const existingMainTextBlocks = findMainTextBlocks(state.messages.entities[assistantMsgId])
        if (existingMainTextBlocks.length > 0) {
          const existingMainTextBlock = existingMainTextBlocks[0]
          const currentRefs = existingMainTextBlock.citationReferences || []
          const mainTextChanges = {
            citationReferences: [...currentRefs, { blockId, citationBlockSource: llmWebSearchResult.source }]
          }
          blockManager.smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MESSAGE_BLOCK_TYPE.MAIN_TEXT, true)
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
            status: MESSAGE_BLOCK_STATUS.SUCCESS
          }
        )
        citationBlockId = citationBlock.id

        const state = getState()
        const existingMainTextBlocks = findMainTextBlocks(state.messages.entities[assistantMsgId])
        if (existingMainTextBlocks.length > 0) {
          const existingMainTextBlock = existingMainTextBlocks[0]
          const currentRefs = existingMainTextBlock.citationReferences || []
          const mainTextChanges = {
            citationReferences: [...currentRefs, { citationBlockId, citationBlockSource: llmWebSearchResult.source }]
          }
          blockManager.smartBlockUpdate(existingMainTextBlock.id, mainTextChanges, MESSAGE_BLOCK_TYPE.MAIN_TEXT, true)
        }
        await blockManager.handleBlockTransition(citationBlock, MESSAGE_BLOCK_TYPE.CITATION)
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
