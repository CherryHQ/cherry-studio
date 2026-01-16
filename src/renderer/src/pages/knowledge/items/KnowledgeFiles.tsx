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
import type { FileItemData, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
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
} from '../KnowledgeContent'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

// 将文件扩展名数组转换为 Dropzone accept 格式
const dropzoneAccept = fileTypes.reduce(
  (acc, ext) => {
    // 获取 MIME 类型的简单映射
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.epub': 'application/epub+zip'
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    if (!acc[mime]) {
      acc[mime] = []
    }
    acc[mime].push(ext)
    return acc
  },
  {} as Record<string, string[]>
)

const getDisplayTime = (item: KnowledgeItemV2) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format('MM-DD HH:mm')
}

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
        <Dropzone
          onDrop={(files) => handleDrop(files)}
          accept={dropzoneAccept}
          maxFiles={999}
          disabled={disabled}
          noClick>
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
                      extra: `${getDisplayTime(item)} · ${formatFileSize(file.size)}`,
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
