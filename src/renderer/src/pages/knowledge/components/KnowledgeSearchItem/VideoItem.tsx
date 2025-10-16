import { loggerService } from '@logger'
import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactPlayer from 'react-player'
import styled from 'styled-components'

import { CopyButtonContainer, KnowledgeItemMetadata } from './components'
import { useHighlightText } from './hooks'

interface Props {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
  searchKeyword: string
}

const logger = loggerService.withContext('KnowledgeSearchPopup VideoItem')

const VideoItem: FC<Props> = ({ item, searchKeyword }) => {
  const { t } = useTranslation()
  const playerRef = useRef<HTMLVideoElement | null>(null)

  const { highlightText } = useHighlightText()

  /**
   * 渲染本地视频文件
   */
  const renderLocalVideo = () => {
    if (!item.metadata.video.path) {
      logger.warn('Local video was requested but block.filePath is missing.')
      return <ErrorContainer>{t('knowledge.error.video.local_file_missing')}</ErrorContainer>
    }

    const videoSrc = `file://${item.metadata?.video?.path}`

    const handleReady = () => {
      const startTime = Math.floor(item.metadata?.startTime ?? 0)
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
    switch (item.metadata?.type) {
      case 'video':
        return renderLocalVideo()

      default:
        return
    }
  }

  return (
    <>
      <KnowledgeItemMetadata item={item} />
      <CopyButtonContainer textToCopy={item.pageContent} />
      <p className="mb-0 select-text">{highlightText(item.pageContent, searchKeyword)}</p>
      <VideoContainer>{renderVideo()}</VideoContainer>
    </>
  )
}

export default React.memo(VideoItem)

const VideoContainer = styled.div`
  width: 100%;
  aspect-ratio: 16 / 9;
  height: auto;
  background-color: #000;
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
`

const ErrorContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
`
