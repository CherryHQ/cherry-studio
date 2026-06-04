import { loggerService } from '@renderer/services/LoggerService'
import type { FC } from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactPlayer from 'react-player'

const logger = loggerService.withContext('MessageVideo')
interface Props {
  url?: string
  filePath?: string
  videoPath?: string
  startTime?: number
}

const MessageVideo: FC<Props> = ({ url, filePath, videoPath, startTime }) => {
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const { t } = useTranslation()

  logger.debug(`MessageVideo: ${JSON.stringify({ url, filePath, videoPath, startTime })}`)

  if (!url && !filePath) {
    return null
  }

  /**
   * 渲染本地视频文件
   */
  const renderLocalVideo = () => {
    if (!filePath) {
      logger.warn('Local video was requested but filePath is missing.')
      return <div>{t('message.video.error.local_file_missing')}</div>
    }

    const videoSrc = `file://${videoPath ?? filePath}`

    const handleReady = () => {
      const start = Math.floor(startTime ?? 0)
      if (playerRef.current) {
        playerRef.current.currentTime = start
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
    if (filePath) {
      return renderLocalVideo()
    }

    logger.warn(`Unsupported video or missing necessary data.`)
    return <div>{t('message.video.error.unsupported_type')}</div>
  }

  return <div className="aspect-video h-auto w-full max-w-[560px] bg-black">{renderVideo()}</div>
}

export default MessageVideo
