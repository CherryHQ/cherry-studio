import { DeleteOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import VideoPopup from '@renderer/components/Popups/VideoPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { getProviderName } from '@renderer/services/ProviderService'
import { FileMetadata, FileTypes, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { Button, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { Plus } from 'lucide-react'
import VirtualList from 'rc-virtual-list'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('KnowledgeVideos')

import FileItem from '@renderer/pages/files/FileItem'
import { formatFileSize } from '@renderer/utils'

import StatusIcon from '../components/StatusIcon'
import {
  ClickableSpan,
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  RefreshIcon,
  StatusIconWrapper
} from '../KnowledgeContent'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeVideos: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  const { base, videoItems, refreshItem, removeItem, getProcessingStatus, addVideo } = useKnowledge(
    selectedBase.id || ''
  )
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)

  const providerName = getProviderName(base?.model.provider || '')
  const disabled = !base?.version || !providerName

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!base) {
    return null
  }

  const handleAddVideo = async () => {
    if (disabled) {
      return
    }

    const result = await VideoPopup.show({
      title: t('knowledge.add_video')
    })
    if (!result) {
      return
    }

    if (result && result.videoFile && result.srtFile) {
      addVideo([result.videoFile, result.srtFile])
    }
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddVideo()
          }}
          disabled={disabled}>
          {t('knowledge.add_video')}
        </Button>
      </ItemHeader>
      <ItemFlexColumn>
        {videoItems.length === 0 ? (
          <KnowledgeEmptyView />
        ) : (
          <VirtualList
            data={videoItems.reverse()}
            height={windowHeight - 270}
            itemHeight={75}
            itemKey="id"
            styles={{
              verticalScrollBar: { width: 6 },
              verticalScrollBarThumb: { background: 'var(--color-scrollbar-thumb)' }
            }}>
            {(item) => {
              const files = item.content as FileMetadata[]
              const videoFile = files.find((f) => f.type === FileTypes.VIDEO)

              if (!videoFile) {
                logger.warn('Knowledge item is missing video file data.', { itemId: item.id })
                return null
              }

              return (
                <div style={{ height: '75px', paddingTop: '12px' }}>
                  <FileItem
                    key={item.id}
                    fileInfo={{
                      name: (
                        <ClickableSpan onClick={() => window.api.file.openFileWithRelativePath(videoFile)}>
                          <Ellipsis>
                            <Tooltip title={videoFile.origin_name}>{videoFile.origin_name}</Tooltip>
                          </Ellipsis>
                        </ClickableSpan>
                      ),
                      ext: videoFile.ext,
                      extra: `${getDisplayTime(item)} · ${formatFileSize(videoFile.size)}`,
                      actions: (
                        <FlexAlignCenter>
                          {item.uniqueId && (
                            <Button type="text" icon={<RefreshIcon />} onClick={() => refreshItem(item)} />
                          )}

                          <StatusIconWrapper>
                            <StatusIcon
                              sourceId={item.id}
                              base={base}
                              getProcessingStatus={getProcessingStatus}
                              type="file"
                            />
                          </StatusIconWrapper>
                          <Button type="text" danger onClick={() => removeItem(item)} icon={<DeleteOutlined />} />
                        </FlexAlignCenter>
                      )
                    }}
                  />
                </div>
              )
            }}
          </VirtualList>
        )}
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

export default KnowledgeVideos
