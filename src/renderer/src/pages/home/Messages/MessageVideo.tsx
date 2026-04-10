import { loggerService } from '@renderer/services/LoggerService'
import type { VideoMessageBlock } from '@renderer/types/newMessage'
import type { FC } from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactPlayer from 'react-player'

const logger = loggerService.withContext('MessageVideo')
interface Props {
  block: VideoMessageBlock
}

const MessageVideo: FC<Props> = ({ block }) => {
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const { t } = useTranslation()

  logger.debug(`MessageVideo: ${JSON.stringify(block)}`)

  if (!block.url && !block.filePath) {
    return null
  }

  /**
   * 渲染本地视频文件
   */
  const renderLocalVideo = () => {
    if (!block.filePath) {
      logger.warn('Local video was requested but block.filePath is missing.')
      return <div>{t('message.video.error.local_file_missing')}</div>
    }

    const videoSrc = `file://${block.metadata?.video.path}`

    const handleReady = () => {
      const startTime = Math.floor(block.metadata?.startTime ?? 0)
      if (playerRef.current) {
        playerRef.current.currentTime = startTime
      }
    }

    return (
      <ReactPlayer
        ref={playerRef}
        style={{
          height: '100%',
          width: '100%'
        }}
        src={videoSrc}
        controls
        onReady={handleReady}
      />
    )
  }

  const renderVideo = () => {
    switch (block.metadata?.type) {
      case 'video':
        return renderLocalVideo()

      default:
        if (block.filePath) {
          logger.warn(
            `Unknown video type: ${block.metadata?.type}, but with filePath will try to render as local video.`
          )
          return renderLocalVideo()
        }

        logger.warn(`Unsupported video type: ${block.metadata?.type} or missing necessary data.`)
        return <div>{t('message.video.error.unsupported_type')}</div>
    }
  }

  return <div className="aspect-video h-auto w-full max-w-[560px] bg-black">{renderVideo()}</div>
}

export default MessageVideo
