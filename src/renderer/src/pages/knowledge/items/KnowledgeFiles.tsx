import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { useFiles } from '@renderer/hooks/useFiles'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import StatusIcon from '@renderer/pages/knowledge/components/StatusIcon'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import type { FileMetadata, FileTypes, KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'
import { isKnowledgeFileItem } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import type { FileItemData, ItemStatus, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Upload } from 'antd'
import dayjs from 'dayjs'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('KnowledgeFiles')

import { DeleteIcon } from '@renderer/components/Icons'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { PlusIcon } from 'lucide-react'

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

const { Dragger } = Upload

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

/**
 * Map v2 ItemStatus to v1 ProcessingStatus
 */
const mapV2StatusToV1 = (status: ItemStatus): ProcessingStatus => {
  const statusMap: Record<ItemStatus, ProcessingStatus> = {
    idle: 'pending',
    pending: 'pending',
    preprocessing: 'processing',
    embedding: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
  return statusMap[status] ?? 'pending'
}

/**
 * Convert v2 KnowledgeItem (file type) to v1 format for UI compatibility
 */
const toV1FileItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as FileItemData
  return {
    id: item.id,
    type: item.type,
    content: data.file,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0,
    // v2 completed items have embedded vectors
    uniqueId: item.status === 'completed' ? item.id : undefined
  }
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeFiles: FC<KnowledgeContentProps> = ({ selectedBase, progressMap, preprocessMap }) => {
  const { t } = useTranslation()
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const { onSelectFile, selecting } = useFiles({ extensions: fileTypes })

  const {
    fileItems: v2FileItems,
    hasProcessingItems,
    addFiles,
    deleteItem,
    refreshItem
  } = useKnowledgeFiles(selectedBase.id || '')

  // Convert v2 file items to v1 format
  const fileItems = useMemo(() => {
    return v2FileItems.map(toV1FileItem)
  }, [v2FileItems])

  // Create a map of item statuses for getProcessingStatus
  const statusMap = useMemo(() => {
    const map = new Map<string, ProcessingStatus>()
    v2FileItems.forEach((item) => {
      const v1Status = mapV2StatusToV1(item.status)
      // Only set status if not completed (completed items show checkmark)
      if (item.status !== 'completed') {
        map.set(item.id, v1Status)
      }
    })
    return map
  }, [v2FileItems])

  // Create a fake base object with items for StatusIcon compatibility
  const baseWithItems = useMemo(() => {
    return {
      ...selectedBase,
      items: fileItems
    }
  }, [selectedBase, fileItems])

  // getProcessingStatus function for StatusIcon
  const getProcessingStatus = useCallback(
    (sourceId: string): ProcessingStatus | undefined => {
      return statusMap.get(sourceId)
    },
    [statusMap]
  )

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleAddFile = async () => {
    if (disabled || selecting) {
      return
    }
    const selectedFiles = await onSelectFile({ multipleSelections: true })
    processFiles(selectedFiles)
  }

  const handleDrop = async (files: File[]) => {
    if (disabled) {
      return
    }
    if (files) {
      const _files: FileMetadata[] = files
        .map((file) => {
          // 这个路径 filePath 很可能是在文件选择时的原始路径。
          const filePath = window.api.file.getPathForFile(file)
          let nameFromPath = filePath
          const lastSlash = filePath.lastIndexOf('/')
          const lastBackslash = filePath.lastIndexOf('\\')
          if (lastSlash !== -1 || lastBackslash !== -1) {
            nameFromPath = filePath.substring(Math.max(lastSlash, lastBackslash) + 1)
          }

          // 从派生的文件名中获取扩展名
          const extFromPath = nameFromPath.includes('.') ? `.${nameFromPath.split('.').pop()}` : ''

          return {
            id: uuid(),
            name: nameFromPath, // 使用从路径派生的文件名
            path: filePath,
            size: file.size,
            ext: extFromPath.toLowerCase(),
            count: 1,
            origin_name: file.name, // 保存 File 对象中原始的文件名
            type: file.type as FileTypes,
            created_at: new Date().toISOString()
          }
        })
        .filter(({ ext }) => fileTypes.includes(ext))
      processFiles(_files)
    }
  }

  const processFiles = async (files: FileMetadata[]) => {
    logger.debug('processFiles', files)
    if (files.length > 0) {
      const uploadedFiles = await FileManager.uploadFiles(files)
      addFiles(uploadedFiles)
    }
  }

  const showPreprocessIcon = (item: KnowledgeItem) => {
    if (selectedBase.preprocessProvider && item.isPreprocessed !== false) {
      return true
    }
    if (!selectedBase.preprocessProvider && item.isPreprocessed === true) {
      return true
    }
    return false
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton size="sm" variant="default" onClick={handleAddFile} disabled={disabled}>
          <PlusIcon size={16} />
          {t('knowledge.add_file')}
        </ResponsiveButton>
        {hasProcessingItems && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>同步中...</span>}
      </ItemHeader>

      <ItemFlexColumn>
        <div
          onClick={(e) => {
            e.stopPropagation()
            handleAddFile()
          }}>
          <Dragger
            showUploadList={false}
            customRequest={({ file }) => handleDrop([file as File])}
            multiple={true}
            accept={fileTypes.join(',')}
            openFileDialogOnClick={false}>
            <p className="ant-upload-text">{t('knowledge.drag_file')}</p>
            <p className="ant-upload-hint">
              {t('knowledge.file_hint', { file_types: 'TXT, MD, HTML, PDF, DOCX, PPTX, XLSX, EPUB...' })}
            </p>
          </Dragger>
        </div>
        {fileItems.length === 0 ? (
          <KnowledgeEmptyView />
        ) : (
          <DynamicVirtualList
            list={[...fileItems].reverse()}
            estimateSize={estimateSize}
            overscan={2}
            scrollerStyle={{ height: windowHeight - 270 }}
            autoHideScrollbar>
            {(item) => {
              if (!isKnowledgeFileItem(item)) {
                return null
              }
              const file = item.content
              return (
                <div style={{ height: '75px', paddingTop: '12px' }}>
                  <FileItem
                    key={item.id}
                    fileInfo={{
                      name: (
                        <ClickableSpan onClick={() => window.api.file.openFileWithRelativePath(file)}>
                          <Ellipsis>
                            <Tooltip content={file.origin_name}>{file.origin_name}</Tooltip>
                          </Ellipsis>
                        </ClickableSpan>
                      ),
                      ext: file.ext,
                      extra: `${getDisplayTime(item)} · ${formatFileSize(file.size)}`,
                      actions: (
                        <FlexAlignCenter>
                          {item.uniqueId && (
                            <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                              <RefreshIcon />
                            </Button>
                          )}
                          {showPreprocessIcon(item) && (
                            <StatusIconWrapper>
                              <StatusIcon
                                sourceId={item.id}
                                base={baseWithItems}
                                getProcessingStatus={getProcessingStatus}
                                type="file"
                                isPreprocessed={preprocessMap.get(item.id) || item.isPreprocessed || false}
                                progress={progressMap.get(item.id)}
                              />
                            </StatusIconWrapper>
                          )}
                          <StatusIconWrapper>
                            <StatusIcon
                              sourceId={item.id}
                              base={baseWithItems}
                              getProcessingStatus={getProcessingStatus}
                              type="file"
                            />
                          </StatusIconWrapper>
                          <Button variant="ghost" onClick={() => deleteItem(item.id)}>
                            <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                          </Button>
                        </FlexAlignCenter>
                      )
                    }}
                  />
                </div>
              )
            }}
          </DynamicVirtualList>
        )}
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  gap: 10px;
`

export default KnowledgeFiles
