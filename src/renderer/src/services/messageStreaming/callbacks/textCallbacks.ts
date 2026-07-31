import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ProviderMetadata } from '@renderer/types/chunk'
import type { CitationMessageBlock, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createMainTextBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'
import { createStreamingTextProjection } from '../streamingTextProjection'

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
  let lastFullText = ''
  // Track thoughtSignature for Gemini thought signature persistence
  let currentThoughtSignature: string | undefined

  return {
    getCurrentMainTextBlockId: () => mainTextBlockId,
    flushPendingText: async () => {
      if (!mainTextBlockId || !lastFullText) return

      blockManager.smartBlockUpdate(mainTextBlockId, { content: lastFullText }, MessageBlockType.MAIN_TEXT, true)
    },
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
      const citationBlockSource = citationBlockId
        ? (getState().messageBlocks.entities[citationBlockId] as CitationMessageBlock).response?.source
        : WEB_SEARCH_SOURCE.WEBSEARCH
      if (text) {
        lastFullText = text
        const blockChanges: Partial<MessageBlock> = {
          content: createStreamingTextProjection(text, ({ language, lineCount, charCount }) => {
            return i18n.t('html_artifacts.code_block_progress', {
              language,
              lines: lineCount.toLocaleString(),
              characters: charCount.toLocaleString()
            })
          }),
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
        lastFullText = ''
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
