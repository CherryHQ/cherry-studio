import { Button } from '@heroui/react'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { useFiles } from '@renderer/hooks/useFiles'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import StatusIcon from '@renderer/pages/knowledge/components/StatusIcon'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import type { FileMetadata, FileTypes, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { isKnowledgeFileItem } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import dayjs from 'dayjs'
import type { FC } from 'react'
import type { DragEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  StatusIconWrapper
} from '../KnowledgeContent'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeFiles: FC<KnowledgeContentProps> = ({ selectedBase, progressMap, preprocessMap }) => {
  const { t } = useTranslation()
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = useRef(0)
  const { onSelectFile, selecting } = useFiles({ extensions: fileTypes })

  const { base, fileItems, addFiles, refreshItem, removeItem, getProcessingStatus } = useKnowledge(
    selectedBase.id || ''
  )

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const providerName = getProviderName(base?.model)
  const disabled = !base?.version || !providerName

  const estimateSize = useCallback(() => 75, [])

  if (!base) {
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

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current += 1
    if (!disabled) {
      setIsDraggingFiles(true)
    }
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setIsDraggingFiles(false)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
  }

  const handleDropEvent = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingFiles(false)

    if (disabled) {
      return
    }

    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      void handleDrop(files)
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
    if (base.preprocessProvider && item.isPreprocessed !== false) {
      return true
    }
    if (!base.preprocessProvider && item.isPreprocessed === true) {
      return true
    }
    return false
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <Button
          size="sm"
          color="primary"
          startContent={<PlusIcon size={16} />}
          onClick={(e) => {
            e.stopPropagation()
            handleAddFile()
          }}
          isDisabled={disabled}>
          {t('knowledge.add_file')}
        </Button>
      </ItemHeader>

      <div className="flex flex-col px-4 py-5 gap-2.5">
        <div
          role="button"
          tabIndex={0}
          className={`flex flex-col items-center justify-center gap-2 p-6 border border-dashed border-[var(--color-border)] rounded-xl text-center cursor-pointer transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-4 hover:bg-[var(--color-fill-tertiary)] ${
            isDraggingFiles ? 'bg-[var(--color-fill-tertiary)]' : 'bg-transparent'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            handleAddFile()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              handleAddFile()
            }
          }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDropEvent}>
          <p className="font-semibold text-[var(--color-text)] m-0">{t('knowledge.drag_file')}</p>
          <p className="text-xs text-[var(--color-text-2)] m-0">
            {t('knowledge.file_hint', { file_types: 'TXT, MD, HTML, PDF, DOCX, PPTX, XLSX, EPUB...' })}
          </p>
        </div>
        {fileItems.length === 0 ? (
          <KnowledgeEmptyView />
        ) : (
          <DynamicVirtualList
            list={fileItems.reverse()}
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
                            {file.origin_name}
                          </Ellipsis>
                        </ClickableSpan>
                      ),
                      ext: file.ext,
                      extra: `${getDisplayTime(item)} · ${formatFileSize(file.size)}`,
                      actions: (
                        <FlexAlignCenter>
                          {item.uniqueId && (
                            <Button
                              size="sm"
                              isIconOnly
                              variant="light"
                              onClick={() => refreshItem(item)}
                              aria-label="Refresh file">
                              <RefreshIcon />
                            </Button>
                          )}
                          {showPreprocessIcon(item) && (
                            <StatusIconWrapper>
                              <StatusIcon
                                sourceId={item.id}
                                base={base}
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
                              base={base}
                              getProcessingStatus={getProcessingStatus}
                              type="file"
                            />
                          </StatusIconWrapper>
                          <Button
                            size="sm"
                            isIconOnly
                            variant="light"
                            color="danger"
                            onClick={() => removeItem(item)}
                            aria-label="Delete file">
                            <DeleteIcon size={14} className="lucide-custom" />
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
      </div>
    </ItemContainer>
  )
}

export default KnowledgeFiles
