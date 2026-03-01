import { loggerService } from '@logger'
import type { ImageMessageBlock } from '@renderer/types/newMessage'
import { MESSAGE_BLOCK_STATUS, MESSAGE_BLOCK_TYPE } from '@renderer/types/newMessage'
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
      if (blockManager.hasInitialPlaceholder) {
        const initialChanges = {
          type: MESSAGE_BLOCK_TYPE.IMAGE,
          status: MESSAGE_BLOCK_STATUS.PENDING
        }
        imageBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(imageBlockId, initialChanges, MESSAGE_BLOCK_TYPE.IMAGE)
      } else if (!imageBlockId) {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MESSAGE_BLOCK_STATUS.PENDING
        })
        imageBlockId = imageBlock.id
        await blockManager.handleBlockTransition(imageBlock, MESSAGE_BLOCK_TYPE.IMAGE)
      }
    },

    onImageDelta: (imageData: any) => {
      const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
      if (imageBlockId) {
        const changes: Partial<ImageMessageBlock> = {
          url: imageUrl,
          metadata: { generateImageResponse: imageData },
          status: MESSAGE_BLOCK_STATUS.STREAMING
        }
        blockManager.smartBlockUpdate(imageBlockId, changes, MESSAGE_BLOCK_TYPE.IMAGE, true)
      }
    },

    onImageGenerated: async (imageData: any) => {
      if (imageBlockId) {
        if (!imageData) {
          const changes: Partial<ImageMessageBlock> = {
            status: MESSAGE_BLOCK_STATUS.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MESSAGE_BLOCK_TYPE.IMAGE)
        } else {
          const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
          const changes: Partial<ImageMessageBlock> = {
            url: imageUrl,
            metadata: { generateImageResponse: imageData },
            status: MESSAGE_BLOCK_STATUS.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MESSAGE_BLOCK_TYPE.IMAGE, true)
        }
        imageBlockId = null
      } else {
        if (imageData) {
          const imageBlock = createImageBlock(assistantMsgId, {
            status: MESSAGE_BLOCK_STATUS.SUCCESS,
            url: imageData.images?.[0] || 'placeholder_image_url',
            metadata: { generateImageResponse: imageData }
          })
          await blockManager.handleBlockTransition(imageBlock, MESSAGE_BLOCK_TYPE.IMAGE)
        } else {
          logger.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
        }
      }
    },

    onImageSearched: async (content: string, metadata: Record<string, any>) => {
      if (!imageBlockId) {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MESSAGE_BLOCK_STATUS.SUCCESS,
          metadata: {
            generateImageResponse: {
              type: 'base64',
              images: [`data:${metadata.mime};base64,${content}`]
            }
          }
        })
        await blockManager.handleBlockTransition(imageBlock, MESSAGE_BLOCK_TYPE.IMAGE)
      }
    }
  }
}
