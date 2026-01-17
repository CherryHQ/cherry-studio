import { Button, Dropzone, DropzoneEmptyState, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledge.v2'
import StatusIcon from '@renderer/pages/knowledge/components/StatusIcon'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import type { FileMetadata, FileTypes, KnowledgeBase } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import type { FileItemData } from '@shared/data/types/knowledge'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('KnowledgeFiles')

import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { Book, RotateCw, Trash2 } from 'lucide-react'

import { formatKnowledgeItemTime } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const KnowledgeFiles: FC<KnowledgeContentProps> = ({ selectedBase, progressMap, preprocessMap }) => {
  const { t } = useTranslation()
  const [windowHeight, setWindowHeight] = useState(window.innerHeight)

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
    <div className="flex flex-col">
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
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ height: windowHeight - 270 }}
          autoHideScrollbar>
          {(item) => {
            const file = (item.data as FileItemData).file
            return (
              <div
                className="flex flex-row items-center justify-between rounded-3xs border border-border p-2"
                key={item.id}>
                <div className="flex cursor-pointer flex-row items-center gap-2">
                  <Book size={18} className="text-foreground" />
                  <div onClick={() => window.api.file.openFileWithRelativePath(file)}>
                    <Tooltip content={file.origin_name}>{file.origin_name}</Tooltip>
                  </div>
                  <div className="text-foreground-muted">|</div>
                  <div className="text-foreground-muted">
                    {formatKnowledgeItemTime(item)} · {formatFileSize(file.size)}
                  </div>
                </div>
                <div className="flex items-center">
                  {item.status === 'completed' && (
                    <Button size="icon-sm" variant="ghost" onClick={() => refreshItem(item.id)}>
                      <RotateCw size={16} className="text-foreground" />
                    </Button>
                  )}
                  {showPreprocessIcon(item.id) && (
                    <Button size="icon-sm" variant="ghost">
                      <StatusIcon
                        sourceId={item.id}
                        item={item}
                        type="file"
                        isPreprocessed={preprocessMap.get(item.id) || false}
                        progress={progressMap.get(item.id)}
                      />
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost">
                    <StatusIcon sourceId={item.id} item={item} type="file" />
                  </Button>

                  <Button size="icon-sm" variant="ghost" onClick={() => deleteItem(item.id)}>
                    <Trash2 size={16} className="text-red-600" />
                  </Button>
                </div>
              </div>
            )
          }}
        </DynamicVirtualList>
      </div>
    </div>
  )
}

export default KnowledgeFiles
