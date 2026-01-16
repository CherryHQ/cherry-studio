import { Button, Dropzone, DropzoneEmptyState, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { useFiles } from '@renderer/hooks/useFiles'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import StatusIcon from '@renderer/pages/knowledge/components/StatusIcon'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import type { FileMetadata, FileTypes, KnowledgeBase } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import type { FileItemData } from '@shared/data/types/knowledge'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  ResponsiveButton,
  StatusIconWrapper
} from '../components/KnowledgeItemLayout'
import { formatKnowledgeItemTime } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

const KnowledgeFiles: FC<KnowledgeContentProps> = ({ selectedBase, progressMap, preprocessMap }) => {
  const { t } = useTranslation()
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)
  const { onSelectFile, selecting } = useFiles({ extensions: fileTypes })

  const { fileItems: v2FileItems, addFiles, deleteItem, refreshItem } = useKnowledgeFiles(selectedBase.id || '')

  const reversedItems = useMemo(() => [...v2FileItems].reverse(), [v2FileItems])

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
    if (files && files.length > 0) {
      const _files: FileMetadata[] = files
        .map((file) => {
          // 在 Electron 中，拖拽的文件有 path 属性
          // react-dropzone 的 File 对象可能需要通过 (file as any).path 访问
          const filePath = (file as any).path || window.api.file.getPathForFile(file) || ''

          let nameFromPath = filePath
          const lastSlash = filePath.lastIndexOf('/')
          const lastBackslash = filePath.lastIndexOf('\\')
          if (lastSlash !== -1 || lastBackslash !== -1) {
            nameFromPath = filePath.substring(Math.max(lastSlash, lastBackslash) + 1)
          }

          // 如果无法从路径获取文件名，使用 File 对象的 name
          if (!nameFromPath) {
            nameFromPath = file.name
          }

          // 从文件名中获取扩展名
          const extFromPath = nameFromPath.includes('.') ? `.${nameFromPath.split('.').pop()}` : ''

          return {
            id: uuid(),
            name: nameFromPath,
            path: filePath,
            size: file.size,
            ext: extFromPath.toLowerCase(),
            count: 1,
            origin_name: file.name,
            type: file.type as FileTypes,
            created_at: new Date().toISOString()
          }
        })
        .filter((file) => {
          if (!file.path) {
            logger.warn('File dropped without path, skipping', { name: file.origin_name })
            return false
          }
          return true
        })

      if (_files.length === 0 && files.length > 0) {
        window.toast.error(t('knowledge.error.file_path_not_available'))
      } else {
        processFiles(_files)
      }
    }
  }

  const handleDropError = (error: Error) => {
    logger.error('Dropzone error', error)
    window.toast.error(error.message)
  }

  const processFiles = async (files: FileMetadata[]) => {
    logger.debug('processFiles', files)
    if (files.length === 0) {
      return
    }

    const startedAt = Date.now()
    logger.info('KnowledgeFiles.processFiles:start', { baseId: selectedBase.id, count: files.length })

    try {
      const uploadedFiles = await FileManager.uploadFiles(files)
      logger.info('KnowledgeFiles.processFiles:done', {
        baseId: selectedBase.id,
        count: uploadedFiles.length,
        durationMs: Date.now() - startedAt
      })
      addFiles(uploadedFiles)
    } catch (error) {
      logger.error('KnowledgeFiles.processFiles:failed', error as Error, {
        baseId: selectedBase.id,
        durationMs: Date.now() - startedAt
      })
      throw error
    }
  }

  const showPreprocessIcon = (itemId: string) => {
    if (selectedBase.preprocessProvider) {
      return true
    }
    return preprocessMap.get(itemId) === true
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton size="sm" variant="default" onClick={handleAddFile} disabled={disabled}>
          <PlusIcon size={16} />
          {t('knowledge.add_file')}
        </ResponsiveButton>
      </ItemHeader>

      <div className="flex flex-col gap-2.5 px-4 py-5">
        <Dropzone onDrop={handleDrop} onError={handleDropError} maxFiles={999} disabled={disabled}>
          <DropzoneEmptyState>
            <div className="flex flex-col items-center justify-center">
              <p className="my-2 w-full truncate text-wrap text-center font-medium text-sm">
                {t('knowledge.drag_file')}
              </p>
              <p className="w-full text-wrap text-center text-muted-foreground text-xs">
                {t('knowledge.file_hint', { file_types: 'TXT, MD, HTML, PDF, DOCX, PPTX, XLSX, EPUB...' })}
              </p>
            </div>
          </DropzoneEmptyState>
        </Dropzone>
        {v2FileItems.length === 0 ? (
          <KnowledgeEmptyView />
        ) : (
          <DynamicVirtualList
            list={reversedItems}
            estimateSize={estimateSize}
            overscan={2}
            scrollerStyle={{ height: windowHeight - 270 }}
            autoHideScrollbar>
            {(item) => {
              const file = (item.data as FileItemData).file
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
                      extra: `${formatKnowledgeItemTime(item)} · ${formatFileSize(file.size)}`,
                      actions: (
                        <FlexAlignCenter>
                          {item.status === 'completed' && (
                            <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                              <RefreshIcon />
                            </Button>
                          )}
                          {showPreprocessIcon(item.id) && (
                            <StatusIconWrapper>
                              <StatusIcon
                                sourceId={item.id}
                                item={item}
                                type="file"
                                isPreprocessed={preprocessMap.get(item.id) || false}
                                progress={progressMap.get(item.id)}
                              />
                            </StatusIconWrapper>
                          )}
                          <StatusIconWrapper>
                            <StatusIcon sourceId={item.id} item={item} type="file" />
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
      </div>
    </ItemContainer>
  )
}

export default KnowledgeFiles
