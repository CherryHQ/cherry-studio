import { Dropzone, DropzoneEmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledge.v2'
import FileManager from '@renderer/services/FileManager'
import { getProviderName } from '@renderer/services/ProviderService'
import type { FileMetadata, FileTypes, KnowledgeBase } from '@renderer/types'
import { formatFileSize, uuid } from '@renderer/utils'
import type { FileItemData } from '@shared/data/types/knowledge'
import { Book } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeItemActions } from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeFiles')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
  preprocessMap: Map<string, boolean>
}

const KnowledgeFiles: FC<KnowledgeContentProps> = ({
  selectedBase,
  progressMap: _progressMap,
  preprocessMap: _preprocessMap
}) => {
  const { t } = useTranslation()
  const { fileItems, addFiles, deleteItem, refreshItem } = useKnowledgeFiles(selectedBase.id || '')

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  if (!selectedBase) {
    return null
  }

  const handleDrop = async (files: File[]) => {
    if (disabled) return
    if (files && files.length > 0) {
      const _files: FileMetadata[] = files
        .map((file) => {
          const filePath = (file as any).path || window.api.file.getPathForFile(file) || ''

          let nameFromPath = filePath
          const lastSlash = filePath.lastIndexOf('/')
          const lastBackslash = filePath.lastIndexOf('\\')
          if (lastSlash !== -1 || lastBackslash !== -1) {
            nameFromPath = filePath.substring(Math.max(lastSlash, lastBackslash) + 1)
          }

          if (!nameFromPath) {
            nameFromPath = file.name
          }

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
    if (files.length === 0) return

    const startedAt = Date.now()
    logger.info('KnowledgeFiles.processFiles:start', {
      baseId: selectedBase.id,
      count: files.length
    })

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
                {t('knowledge.file_hint', {
                  file_types: 'TXT, MD, HTML, PDF, DOCX, PPTX, XLSX, EPUB...'
                })}
              </p>
            </div>
          </DropzoneEmptyState>
        </Dropzone>
        <KnowledgeItemList
          items={fileItems}
          renderItem={(item) => {
            const file = (item.data as FileItemData).file
            return (
              <KnowledgeItemRow
                icon={<Book size={18} className="text-foreground" />}
                content={<div onClick={() => window.api.file.openFileWithRelativePath(file)}>{file.origin_name}</div>}
                metadata={`${formatKnowledgeItemTime(item)} · ${formatFileSize(file.size)}`}
                actions={<KnowledgeItemActions item={item} onRefresh={refreshItem} onDelete={deleteItem} />}
              />
            )
          }}
        />
      </div>
    </div>
  )
}

export default KnowledgeFiles
