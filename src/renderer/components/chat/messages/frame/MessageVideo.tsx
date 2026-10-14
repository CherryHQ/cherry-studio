import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactPlayer from 'react-player'

import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { FileHandle } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { isFileEntryHandle, isFilePathHandle, toFileUrl, tryFileUrlToPath } from '@shared/utils/file'
import { isHttpUrl } from '@shared/utils/url'

const logger = loggerService.withContext('MessageVideo')

interface Props {
  handle?: FileHandle
  url?: string
  filePath?: string
  videoPath?: string
  startTime?: number
}

const MessageVideo: FC<Props> = ({ handle, url, filePath: storedFilePath, videoPath, startTime }) => {
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const { t } = useTranslation()
  const entryId = handle && isFileEntryHandle(handle) ? handle.entryId : undefined
  const [resolved, setResolved] = useState<{ entryId: string; path: string }>()

  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    ipcApi
      .request('file.batch_get_physical_paths', { ids: [entryId] })
      .then((paths) => {
        const path = paths[entryId]
        if (!cancelled && path) setResolved({ entryId, path })
      })
      .catch((error) => logger.warn('Failed to resolve video attachment', { entryId, error }))
    return () => {
      cancelled = true
    }
  }, [entryId])

  const filePath =
    (entryId && resolved?.entryId === entryId ? resolved.path : undefined) ??
    storedFilePath ??
    (handle && isFilePathHandle(handle) ? handle.path : undefined) ??
    (url ? tryFileUrlToPath(url) : undefined)

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

    const videoSrc = toFileUrl(AbsoluteFilePathSchema.parse(videoPath ?? filePath))

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

    if (url && isHttpUrl(url)) {
      return (
        <ReactPlayer
          style={{
            height: '100%',
            width: '100%'
          }}
          src={url}
          controls
        />
      )
    }

    logger.warn(`Unsupported video or missing necessary data.`)
    return <div>{t('message.video.error.unsupported_type')}</div>
  }

  return <div className="aspect-video h-auto w-full max-w-140 bg-black">{renderVideo()}</div>
}

export default MessageVideo
