import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { DeleteIcon } from '@renderer/components/Icons'
import VideoPopup from '@renderer/components/Popups/VideoPopup'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { FileTypes, isKnowledgeVideoItem } from '@renderer/types'
import dayjs from 'dayjs'
import { Plus } from 'lucide-react'
import VirtualList from 'rc-virtual-list'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  ResponsiveButton,
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

  const providerName = getProviderName(base?.model)
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
        <ResponsiveButton
          size="sm"
          variant="solid"
          color="primary"
          startContent={<Plus size={16} />}
          onPress={handleAddVideo}
          isDisabled={disabled}>
          {t('knowledge.add_video')}
        </ResponsiveButton>
      </ItemHeader>
      <div className="flex h-[calc(100vh-135px)] flex-col gap-2.5 px-4 py-5">
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
              if (!isKnowledgeVideoItem(item)) {
                return null
              }
              const files = item.content
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
                            <Tooltip content={videoFile.origin_name}>{videoFile.origin_name}</Tooltip>
                          </Ellipsis>
                        </ClickableSpan>
                      ),
                      ext: videoFile.ext,
                      extra: `${getDisplayTime(item)} · ${formatFileSize(videoFile.size)}`,
                      actions: (
                        <FlexAlignCenter>
                          {item.uniqueId && (
                            <Button
                              variant="light"
                              startContent={<RefreshIcon />}
                              isIconOnly
                              onPress={() => refreshItem(item)}
                            />
                          )}

                          <StatusIconWrapper>
                            <StatusIcon
                              sourceId={item.id}
                              base={base}
                              getProcessingStatus={getProcessingStatus}
                              type="file"
                            />
                          </StatusIconWrapper>
                          <Button
                            variant="light"
                            color="danger"
                            startContent={<DeleteIcon />}
                            isIconOnly
                            onPress={() => removeItem(item)}
                          />
                        </FlexAlignCenter>
                      )
                    }}
                  />
                </div>
              )
            }}
          </VirtualList>
        )}
      </div>
    </ItemContainer>
  )
}

export default KnowledgeVideos
