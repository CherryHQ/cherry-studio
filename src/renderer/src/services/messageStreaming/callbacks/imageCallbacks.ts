import { loggerService } from '@logger'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createImageBlock } from '@renderer/utils/messageUtils/create'

import type { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('ImageCallbacks')

interface ImageCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createImageCallbacks = (deps: ImageCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  let imageBlockId: string | null = null

  return {
    onImageCreated: async () => {
      logger.debug('[onImageCreated] Starting', {
        hasInitialPlaceholder: blockManager.hasInitialPlaceholder,
        currentImageBlockId: imageBlockId,
        placeholderId: blockManager.initialPlaceholderBlockId
      })

      if (blockManager.hasInitialPlaceholder) {
        // Scenario 1: Convert placeholder to image block
        const initialChanges = {
          type: MessageBlockType.IMAGE,
          status: MessageBlockStatus.PENDING
        }
        imageBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(imageBlockId, initialChanges, MessageBlockType.IMAGE)
        logger.debug('[onImageCreated] Converted placeholder to image block', { imageBlockId })
      } else if (!imageBlockId) {
        // Scenario 2: Create new image block
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.PENDING
        })
        imageBlockId = imageBlock.id
        await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
        logger.debug('[onImageCreated] Created new image block', { imageBlockId })
      } else {
        // Scenario 3: imageBlockId already exists (possibly duplicate call)
        logger.warn('[onImageCreated] Image block already exists, skipping creation', { imageBlockId })
      }
    },

    onImageDelta: (imageData: any) => {
      const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
      if (imageBlockId) {
        const changes: Partial<ImageMessageBlock> = {
          url: imageUrl,
          metadata: { generateImageResponse: imageData },
          status: MessageBlockStatus.STREAMING
        }
        blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
      }
    },

    onImageGenerated: async (imageData: any) => {
      logger.debug('[onImageGenerated] Starting', {
        hasImageBlockId: !!imageBlockId,
        imageBlockId,
        hasImageData: !!imageData
      })

      if (imageBlockId) {
        // Normal path: Update existing image block
        if (!imageData) {
          const changes: Partial<ImageMessageBlock> = {
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE)
          logger.debug('[onImageGenerated] Updated existing block to SUCCESS (no data)')
        } else {
          const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
          const changes: Partial<ImageMessageBlock> = {
            url: imageUrl,
            metadata: { generateImageResponse: imageData },
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
          logger.debug('[onImageGenerated] Updated existing block with image data', {
            imageBlockId,
            imageUrl
          })
        }
        imageBlockId = null // Clear state to prepare for next image generation
      } else {
        // imageBlockId is null
        if (imageData) {
          // Check if IMAGE block already exists (prevent duplicate)
          if (blockManager.hasBlockOfType(assistantMsgId, MessageBlockType.IMAGE)) {
            logger.warn('[onImageGenerated] IMAGE block already exists, skipping creation.', { assistantMsgId })
          } else {
            // No IMAGE block exists, create new (normal flow)
            const imageBlock = createImageBlock(assistantMsgId, {
              status: MessageBlockStatus.SUCCESS,
              url: imageData.images?.[0] || 'placeholder_image_url',
              metadata: { generateImageResponse: imageData }
            })
            await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
            logger.debug('[onImageGenerated] Created new image block (no onImageCreated was called)', {
              imageBlockId: imageBlock.id
            })
          }
        } else {
          logger.error('[onImageGenerated] Last block was not an Image block or ID is missing. No image data provided.')
        }
      }
    },

    onImageSearched: async (content: string, metadata: Record<string, any>) => {
      logger.debug('[onImageSearched] Starting', {
        hasImageBlockId: !!imageBlockId,
        imageBlockId,
        hasContent: !!content
      })

      if (!imageBlockId) {
        // onImageSearched always creates a new block by design, as each result is an independent search result
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.SUCCESS,
          metadata: {
            generateImageResponse: {
              type: 'base64',
              images: [`data:${metadata.mime};base64,${content}`]
            }
          }
        })
        await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
        logger.debug('[onImageSearched] Created new image block for searched image')
      } else {
        logger.warn('[onImageSearched] Image block already exists, skipping searched image', { imageBlockId })
      }
    }
  }
}
