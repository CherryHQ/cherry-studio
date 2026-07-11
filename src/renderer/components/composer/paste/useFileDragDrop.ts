import { loggerService } from '@logger'
import { useDrag } from '@renderer/hooks/useDrag'
import { toast } from '@renderer/services/toast'
import type { FileMetadata } from '@renderer/types/file'
import { filterSupportedFiles, isSupportedFile } from '@renderer/utils/file'
import { getFilesFromDropEvent, getTextFromDropEvent } from '@renderer/utils/input'
import { type ComposerAttachment, toComposerAttachments } from '@renderer/utils/message/composerAttachment'
import { isComposerFileTokenPathLike } from '@renderer/utils/message/composerFileTokenSource'
import type { FileUrlString } from '@shared/types/file'
import { fileUrlToPath } from '@shared/utils/file'
import type { TFunction } from 'i18next'
import { useCallback } from 'react'

const logger = loggerService.withContext('useFileDragDrop')

export interface UseFileDragDropOptions {
  supportedExts: string[]
  setFiles: (updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => void
  onTextDropped?: (text: string) => void
  onFolderPathDropped?: (path: string) => void
  enabled?: boolean
  t: TFunction
}

function stripWrappingQuotes(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

export function getSingleDroppedPathFromText(text: string): string | null {
  const lines = text
    .split(/\r\n?|\n/)
    .map((line) => stripWrappingQuotes(line.trim()))
    .filter(Boolean)

  if (lines.length !== 1) return null

  const value = lines[0]
  let path = value

  if (value.toLowerCase().startsWith('file://')) {
    try {
      path = fileUrlToPath(value as FileUrlString)
    } catch {
      path = value
    }
  }

  return isComposerFileTokenPathLike(path) ? path : null
}

async function getDroppedPathKind(path: string): Promise<'file' | 'directory' | null> {
  try {
    return (await window.api.file.isDirectory(path)) ? 'directory' : 'file'
  } catch {
    return null
  }
}

async function splitDroppedFilesByKind(files: FileMetadata[]) {
  const items = await Promise.all(files.map(async (file) => ({ file, kind: await getDroppedPathKind(file.path) })))

  return {
    directories: items.filter((item) => item.kind === 'directory').map((item) => item.file),
    files: items.filter((item) => item.kind !== 'directory').map((item) => item.file)
  }
}

/**
 * Inputbar 文件拖拽上传 Hook
 *
 * 处理文件拖拽、文本拖拽，支持文件类型过滤和错误提示
 *
 * @param options - 拖拽配置选项
 * @returns 拖拽状态和事件处理函数
 *
 * @example
 * ```tsx
 * const dragDrop = useFileDragDrop({
 *   supportedExts: ['.png', '.jpg', '.pdf'],
 *   setFiles: (updater) => setFiles(updater),
 *   onTextDropped: (text) => setText(text),
 *   enabled: true,
 *   t: useTranslation().t
 * })
 *
 * <div
 *   onDragEnter={dragDrop.handleDragEnter}
 *   onDragLeave={dragDrop.handleDragLeave}
 *   onDragOver={dragDrop.handleDragOver}
 *   onDrop={dragDrop.handleDrop}
 *   className={dragDrop.isDragging ? 'dragging' : ''}
 * >
 *   Drop files here
 * </div>
 * ```
 */
export function useFileDragDrop(options: UseFileDragDropOptions) {
  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!options.enabled) {
        return
      }

      // 处理文件拖拽
      const droppedFiles = await getFilesFromDropEvent(event).catch((err) => {
        logger.error('handleDrop:', err)
        return null
      })

      if (droppedFiles && droppedFiles.length > 0) {
        const { directories, files } = await splitDroppedFilesByKind(droppedFiles)
        directories.forEach((directory) => options.onFolderPathDropped?.(directory.path))

        const supportedFiles = await filterSupportedFiles(files, options.supportedExts)
        if (supportedFiles.length > 0) {
          options.setFiles((prevFiles) => [...prevFiles, ...toComposerAttachments(supportedFiles)])
        }

        // 如果有不支持的文件，显示提示
        if (files.length > 0 && supportedFiles.length !== files.length) {
          toast.info(
            options.t('chat.input.file_not_supported_count', {
              count: files.length - supportedFiles.length
            })
          )
        }
        return
      }

      const droppedText = await getTextFromDropEvent(event)
      if (!droppedText) return

      const droppedPath = getSingleDroppedPathFromText(droppedText)
      if (droppedPath) {
        const pathKind = await getDroppedPathKind(droppedPath)
        if (pathKind === 'directory') {
          options.onFolderPathDropped?.(droppedPath)
          return
        }

        if (pathKind === 'file') {
          try {
            const selectedFile = await window.api.file.get(droppedPath)
            if (!selectedFile) {
              options.onTextDropped?.(droppedText)
              return
            }

            const extensionSet = new Set(options.supportedExts)
            if (!(await isSupportedFile(droppedPath, extensionSet))) {
              toast.info(options.t('chat.input.file_not_supported'))
              return
            }

            options.setFiles((prevFiles) => [...prevFiles, ...toComposerAttachments([selectedFile])])
            return
          } catch (error) {
            logger.error('handleDrop path:', error as Error)
            toast.error(options.t('chat.input.file_error'))
            return
          }
        }
      }

      options.onTextDropped?.(droppedText)
    },
    [options]
  )

  const dragState = useDrag(handleDrop)

  return {
    isDragging: options.enabled ? dragState.isDragging : false,
    setIsDragging: dragState.setIsDragging,
    handleDragOver: options.enabled ? dragState.handleDragOver : undefined,
    handleDragEnter: options.enabled ? dragState.handleDragEnter : undefined,
    handleDragLeave: options.enabled ? dragState.handleDragLeave : undefined,
    handleDrop: options.enabled ? dragState.handleDrop : undefined
  }
}
