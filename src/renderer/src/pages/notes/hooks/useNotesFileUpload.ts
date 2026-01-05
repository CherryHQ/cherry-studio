import { loggerService } from '@logger'
import { type FileEntryData } from '@renderer/services/NotesService'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useNotesFileUpload')

interface UseNotesFileUploadProps {
  onUploadFiles: (files: File[] | FileEntryData[], targetFolderPath?: string) => void
  setIsDragOverSidebar: (isDragOver: boolean) => void
  getTargetFolderPath?: () => string | null
  refreshTree?: () => Promise<void>
}

export const useNotesFileUpload = ({
  onUploadFiles,
  setIsDragOverSidebar,
  getTargetFolderPath,
  refreshTree
}: UseNotesFileUploadProps) => {
  const { t } = useTranslation()

  /**
   * Handle drag-and-drop file uploads (VS Code-inspired approach)
   * Uses FileSystemEntry.fullPath to preserve the complete directory structure
   * This ensures dragging ~/Users/me/tmp/xxx creates target/tmp/xxx
   */
  const handleDropFiles = useCallback(
    async (e: React.DragEvent, overrideTargetFolderPath?: string) => {
      e.preventDefault()
      setIsDragOverSidebar(false)

      const items = Array.from(e.dataTransfer.items)
      if (items.length === 0) return

      // Collect all entries with their fullPath preserved
      const entryDataList: FileEntryData[] = []

      const processEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry
          return new Promise<void>((resolve) => {
            fileEntry.file(async (file) => {
              // Get real system path using Electron's webUtils
              const systemPath = window.api.file.getPathForFile(file)
              if (systemPath) {
                entryDataList.push({
                  fullPath: entry.fullPath, // e.g., "/tmp/xxx/subfolder/file.md"
                  isFile: true,
                  isDirectory: false,
                  systemPath
                })
              }
              resolve()
            })
          })
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry
          const reader = dirEntry.createReader()

          // Add directory entry
          entryDataList.push({
            fullPath: entry.fullPath,
            isFile: false,
            isDirectory: true,
            systemPath: '' // Directories don't have systemPath (will be created)
          })

          // IMPORTANT: readEntries() has a browser limit of ~100 entries per call
          // We need to call it repeatedly until it returns an empty array
          return new Promise<void>((resolve, reject) => {
            const readAllEntries = () => {
              reader.readEntries(
                async (entries) => {
                  if (entries.length === 0) {
                    // No more entries, we're done
                    resolve()
                    return
                  }

                  try {
                    // Process current batch
                    const promises = entries.map((subEntry) => processEntry(subEntry))
                    await Promise.all(promises)

                    // Read next batch
                    readAllEntries()
                  } catch (error) {
                    reject(error)
                  }
                },
                (error) => {
                  reject(error)
                }
              )
            }

            readAllEntries()
          })
        }
      }

      if (items[0]?.webkitGetAsEntry()) {
        const promises = items.map((item) => {
          const entry = item.webkitGetAsEntry()
          return entry ? processEntry(entry) : Promise.resolve()
        })

        await Promise.all(promises)

        if (entryDataList.length > 0) {
          // Pass entry data list to parent for recursive upload with optional target override
          onUploadFiles(entryDataList, overrideTargetFolderPath)
        }
      } else {
        // Fallback for browsers without FileSystemEntry API
        const regularFiles = Array.from(e.dataTransfer.files)
        if (regularFiles.length > 0) {
          onUploadFiles(regularFiles, overrideTargetFolderPath)
        }
      }
    },
    [onUploadFiles, setIsDragOverSidebar]
  )

  /**
   * Handle file selection via native Electron dialog
   * Uses dialog.showOpenDialog in Main process for better UX and cross-platform consistency
   * Direct upload using file paths - no unnecessary File object conversion
   */
  const handleSelectFiles = useCallback(async () => {
    try {
      // Get target folder path from parent context
      const targetFolderPath = getTargetFolderPath?.() || ''
      if (!targetFolderPath) {
        throw new Error('No target folder path available')
      }

      // Use Electron native dialog for better UX
      const files = await window.api.file.select({
        title: t('notes.select_files_to_upload'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (files && files.length > 0) {
        // Extract file paths directly from FileMetadata
        const filePaths = files.map((fileMetadata) => fileMetadata.path)

        // Pause file watcher to prevent multiple refresh events
        await window.api.file.pauseFileWatcher()

        try {
          // Use batchUpload with file paths (Main process handles everything)
          const result = await window.api.file.batchUpload(filePaths, targetFolderPath, {
            allowedExtensions: ['.md', '.markdown', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
          })

          logger.info('File selection upload completed:', result)

          // Show success message
          if (result.fileCount > 0) {
            window.toast.success(t('notes.upload_success'))

            // Trigger tree refresh if callback provided
            if (refreshTree) {
              await refreshTree()
            }
          } else {
            window.toast.warning(t('notes.no_valid_files'))
          }
        } finally {
          // Resume watcher and trigger single refresh
          await window.api.file.resumeFileWatcher()
        }
      }
    } catch (error) {
      logger.error('Failed to select files:', error as Error)
      window.toast.error(t('notes.failed_to_select_files'))
    }
  }, [t, getTargetFolderPath, refreshTree])

  /**
   * Handle folder selection via native Electron dialog
   * Recursively lists all markdown files in the selected folder using Main process
   * This provides better performance and avoids non-standard webkitdirectory API
   *
   * Important: We need to preserve the folder name itself (VS Code behavior)
   * Example: Selecting /User/tmp should create targetPath/tmp/...
   */
  const handleSelectFolder = useCallback(async () => {
    try {
      // Use Electron native dialog for folder selection
      const folderPath = await window.api.file.selectFolder({
        title: t('notes.select_folder_to_upload'),
        buttonLabel: t('notes.upload')
      })

      if (!folderPath) {
        return // User cancelled
      }

      logger.info('Selected folder for upload:', { folderPath })

      // Get target folder path from parent context
      const targetFolderPath = getTargetFolderPath?.() || ''
      if (!targetFolderPath) {
        throw new Error('No target folder path available')
      }

      // Use new uploadFolder API that handles everything in Main process
      const result = await window.api.file.uploadFolder(folderPath, targetFolderPath, {
        allowedExtensions: ['.md', '.markdown', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
      })

      logger.info('Folder upload completed:', result)

      // Show success message
      if (result.fileCount > 0) {
        window.toast.success(t('notes.upload_success'))

        // Trigger tree refresh if callback provided
        if (refreshTree) {
          await refreshTree()
        }
      } else {
        window.toast.warning(t('notes.no_markdown_files_in_folder'))
      }
    } catch (error) {
      logger.error('Failed to select folder:', error as Error)
      window.toast.error(t('notes.failed_to_select_folder'))
    }
  }, [t, getTargetFolderPath, refreshTree])

  return {
    handleDropFiles,
    handleSelectFiles,
    handleSelectFolder
  }
}
