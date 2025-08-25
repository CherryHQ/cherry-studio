import { loggerService } from '@renderer/services/LoggerService'
import { VideoMessageBlock } from '@renderer/types/newMessage'
import { FC, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactPlayer from 'react-player'
import YouTube, { YouTubeProps } from 'react-youtube'
import styled from 'styled-components'

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
   * 渲染 YouTube 视频
   */
  const renderYoutube = () => {
    if (!block.url) {
      logger.warn('YouTube video was requested but block.url is missing.')
      return <div>{t('message.video.error.youtube_url_missing')}</div>
    }

    const onPlayerReady: YouTubeProps['onReady'] = (event) => {
      event.target.pauseVideo()
    }

    const opts: YouTubeProps['opts'] = {
      height: '100%',
      width: '100%',
      playerVars: {
        start: Math.floor(block.metadata?.startTime ?? 0)
      }
    }

    return <YouTube style={{ height: '100%', width: '100%' }} videoId={block.url} opts={opts} onReady={onPlayerReady} />
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
      case 'youtube':
        return renderYoutube()

      case 'video':
        return renderLocalVideo()

      default:
        if (block.filePath) {
          logger.warn(`未知的视频类型: ${block.metadata?.type}, 但因存在 filePath 将尝试渲染为本地视频。`)
          return renderLocalVideo()
        }

        logger.warn(`不支持的视频类型: ${block.metadata?.type} 或缺少必要数据。`)
        return <div>{t('message.video.error.unsupported_type')}</div>
    }
  }

  return <Container>{renderVideo()}</Container>
}

export default MessageVideo

const Container = styled.div`
  max-width: 560px;
  width: 100%;
  aspect-ratio: 16 / 9;
  height: auto;
  background-color: #000;
`
