import { loggerService } from '@logger'
import FileManager from '@renderer/services/FileManager'
import type { GenerateImageResponse } from '@renderer/types'
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
      if (blockManager.hasInitialPlaceholder) {
        const initialChanges = {
          type: MessageBlockType.IMAGE,
          status: MessageBlockStatus.PENDING
        }
        imageBlockId = blockManager.initialPlaceholderBlockId!
        blockManager.smartBlockUpdate(imageBlockId, initialChanges, MessageBlockType.IMAGE)
      } else if (!imageBlockId) {
        const imageBlock = createImageBlock(assistantMsgId, {
          status: MessageBlockStatus.PENDING
        })
        imageBlockId = imageBlock.id
        await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
      }
    },

    onImageDelta: (imageData: GenerateImageResponse) => {
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

    onImageGenerated: async (imageData?: GenerateImageResponse) => {
      // For base64 images, persist to disk to avoid sending huge data URIs in future messages
      const buildImageBlockFields = async (imageData: GenerateImageResponse): Promise<Partial<ImageMessageBlock>> => {
        const imageUrl: string = imageData.images?.[0] || 'placeholder_image_url'
        if (imageData.type === 'base64' && imageUrl.startsWith('data:')) {
          const savedFile = await window.api.file.saveBase64Image(imageUrl)
          await FileManager.addFile(savedFile)
          return {
            file: savedFile,
            url: FileManager.getFileUrl(savedFile),
            metadata: { generateImageResponse: imageData },
            status: MessageBlockStatus.SUCCESS
          }
        }
        return {
          url: imageUrl,
          metadata: { generateImageResponse: imageData },
          status: MessageBlockStatus.SUCCESS
        }
      }

      if (imageBlockId) {
        if (!imageData) {
          const changes: Partial<ImageMessageBlock> = {
            status: MessageBlockStatus.SUCCESS
          }
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE)
        } else {
          const changes = await buildImageBlockFields(imageData)
          blockManager.smartBlockUpdate(imageBlockId, changes, MessageBlockType.IMAGE, true)
        }
        imageBlockId = null
      } else {
        if (imageData) {
          const fields = await buildImageBlockFields(imageData)
          const imageBlock = createImageBlock(assistantMsgId, fields)
          await blockManager.handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
        } else {
          logger.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
        }
      }
    },

    onImageSearched: async (content: string, metadata: Record<string, any>) => {
      if (!imageBlockId) {
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
      }
    }
  }
}
