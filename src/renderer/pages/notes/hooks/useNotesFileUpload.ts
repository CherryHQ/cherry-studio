import { useCallback } from 'react'

import { loggerService } from '@logger'

const logger = loggerService.withContext('UseNotesFileUpload')

interface UseNotesFileUploadProps {
  onUploadFiles: (files: File[]) => void
  setIsDragOverSidebar: (isDragOver: boolean) => void
}

/**
 * `readEntries` returns at most 100 entries per call; callers must keep reading
 * until it hands back an empty array, or a large folder is silently truncated.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries)
            return
          }
          entries.push(...batch)
          readBatch()
        },
        (error) => reject(error)
      )
    }
    readBatch()
  })
}

export const useNotesFileUpload = ({ onUploadFiles, setIsDragOverSidebar }: UseNotesFileUploadProps) => {
  const handleDropFiles = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOverSidebar(false)

      // 处理文件夹拖拽：从 dataTransfer.items 获取完整文件路径信息
      const items = Array.from(e.dataTransfer.items)
      const files: File[] = []

      const processEntry = async (entry: FileSystemEntry, path: string = '') => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry
          return new Promise<void>((resolve) => {
            fileEntry.file(
              (file) => {
                // 手动设置 webkitRelativePath 以保持文件夹结构
                Object.defineProperty(file, 'webkitRelativePath', {
                  value: path + file.name,
                  writable: false
                })
                files.push(file)
                resolve()
              },
              (error) => {
                // Without an error callback the promise never settles and the
                // whole drop hangs; skip the unreadable entry instead.
                logger.warn(`Skipped unreadable file while importing notes: ${path}${entry.name}`, error)
                resolve()
              }
            )
          })
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry
          const entries = await readAllEntries(dirEntry.createReader())
          await Promise.all(entries.map((subEntry) => processEntry(subEntry, path + entry.name + '/')))
        }
      }

      // 如果支持 DataTransferItem API（文件夹拖拽）
      if (items.length > 0 && items[0].webkitGetAsEntry()) {
        const promises = items.map((item) => {
          const entry = item.webkitGetAsEntry()
          return entry
            ? processEntry(entry).catch((error) => logger.warn('Failed to import a dropped entry', error))
            : Promise.resolve()
        })

        await Promise.all(promises)

        if (files.length > 0) {
          onUploadFiles(files)
        }
      } else {
        const regularFiles = Array.from(e.dataTransfer.files)
        if (regularFiles.length > 0) {
          onUploadFiles(regularFiles)
        }
      }
    },
    [onUploadFiles, setIsDragOverSidebar]
  )

  const handleSelectFiles = useCallback(() => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.accept = '.md,.markdown'
    fileInput.webkitdirectory = false

    fileInput.onchange = (e) => {
      const target = e.target as HTMLInputElement
      if (target.files && target.files.length > 0) {
        const selectedFiles = Array.from(target.files)
        onUploadFiles(selectedFiles)
      }
      fileInput.remove()
    }

    fileInput.click()
  }, [onUploadFiles])

  const handleSelectFolder = useCallback(() => {
    const folderInput = document.createElement('input')
    folderInput.type = 'file'
    // @ts-ignore - webkitdirectory is a non-standard attribute
    folderInput.webkitdirectory = true
    // @ts-ignore - directory is a non-standard attribute
    folderInput.directory = true
    folderInput.multiple = true

    folderInput.onchange = (e) => {
      const target = e.target as HTMLInputElement
      if (target.files && target.files.length > 0) {
        const selectedFiles = Array.from(target.files)
        onUploadFiles(selectedFiles)
      }
      folderInput.remove()
    }

    folderInput.click()
  }, [onUploadFiles])

  return {
    handleDropFiles,
    handleSelectFiles,
    handleSelectFolder
  }
}
