import { loggerService } from '@logger'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { createVideoBlock } from '@renderer/utils/messageUtils/create'

import { BlockManager } from '../BlockManager'

const logger = loggerService.withContext('VideoCallbacks')

interface VideoCallbacksDependencies {
  blockManager: BlockManager
  assistantMsgId: string
}

export const createVideoCallbacks = (deps: VideoCallbacksDependencies) => {
  const { blockManager, assistantMsgId } = deps

  // 内部维护的状态
  const videoBlockId: string | null = null

  return {
    onVideoSearched: async (video?: { type: 'url' | 'path'; content: string }, metadata?: Record<string, any>) => {
      if (!video) {
        logger.warn('onVideoSearched called without video data')
        return
      }

      logger.debug(`onVideoSearched video: ${JSON.stringify(video)}, metadata: ${JSON.stringify(metadata)}`)
      if (!videoBlockId) {
        const videoBlock = createVideoBlock(assistantMsgId, {
          status: MessageBlockStatus.SUCCESS,
          url: video.type === 'url' ? video.content : undefined,
          filePath: video.type === 'path' ? video.content : undefined,
          metadata: metadata || {}
        })
        await blockManager.handleBlockTransition(videoBlock, MessageBlockType.VIDEO)
      }
    }
  }
}
