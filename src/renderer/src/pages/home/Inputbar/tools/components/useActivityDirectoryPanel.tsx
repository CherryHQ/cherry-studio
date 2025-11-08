import { loggerService } from '@logger'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { File, Folder } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useActivityDirectoryPanel')

export type ActivityDirectoryTriggerInfo = { type: 'input' | 'button'; position?: number; originalText?: string }

interface Params {
  quickPanel: ToolQuickPanelApi
  accessiblePaths: string[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

export const useActivityDirectoryPanel = (params: Params, role: 'button' | 'manager' = 'button') => {
  const { quickPanel, accessiblePaths, setText } = params
  const { registerTrigger, open, close, updateList } = quickPanel
  const panelSymbol = quickPanel.symbol
  const panelVisible = quickPanel.isVisible
  const { t } = useTranslation()

  const [fileList, setFileList] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const triggerInfoRef = useRef<ActivityDirectoryTriggerInfo | undefined>(undefined)

  /**
   * Remove @ symbol and search text from input
   */
  const removeAtSymbolAndText = useCallback(
    (currentText: string, caretPosition: number, searchText?: string, fallbackPosition?: number) => {
      const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

      if (searchText !== undefined) {
        const pattern = '@' + searchText
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf(pattern, fromIndex)
        if (start !== -1) {
          const end = start + pattern.length
          return currentText.slice(0, start) + currentText.slice(end)
        }

        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
          const expected = pattern
          const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
          if (actual === expected) {
            return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + 1)
        }

        return currentText
      }

      const fromIndex = Math.max(0, safeCaret - 1)
      const start = currentText.lastIndexOf('@', fromIndex)
      if (start === -1) {
        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
          let endPos = fallbackPosition + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(endPos)
        }
        return currentText
      }

      let endPos = start + 1
      while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
        endPos++
      }
      return currentText.slice(0, start) + currentText.slice(endPos)
    },
    []
  )

  /**
   * Insert file path at @ position
   */
  const insertFilePath = useCallback(
    (filePath: string, triggerInfo?: ActivityDirectoryTriggerInfo) => {
      setText((currentText) => {
        const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
        const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length

        // Find @ symbol position
        const atIndex =
          triggerInfo?.position !== undefined ? triggerInfo.position : currentText.lastIndexOf('@', caret - 1)

        if (atIndex !== -1) {
          // Replace @searchText with file path
          return currentText.slice(0, atIndex) + filePath + ' ' + currentText.slice(caret)
        }

        // If no @ found, append at current position
        return currentText.slice(0, caret) + filePath + ' ' + currentText.slice(caret)
      })
    },
    [setText]
  )

  /**
   * Load files from accessible directories
   */
  const loadFiles = useCallback(async () => {
    if (accessiblePaths.length === 0) {
      logger.warn('No accessible paths configured')
      return []
    }

    setIsLoading(true)
    const allFiles: string[] = []

    try {
      for (const dirPath of accessiblePaths) {
        try {
          // TODO: Replace with actual file API when available
          // const files = await window.api.file.listDirectory(dirPath, {
          //   recursive: true,
          //   maxDepth: 3
          // })

          // Mock data for now - in production, this should call the file API
          const mockFiles = [
            `${dirPath}/README.md`,
            `${dirPath}/package.json`,
            `${dirPath}/src/main.ts`,
            `${dirPath}/src/utils.ts`,
            `${dirPath}/src/types.ts`
          ]

          allFiles.push(...mockFiles)
        } catch (error) {
          logger.warn(`Failed to list directory: ${dirPath}`, error as Error)
        }
      }

      return allFiles
    } catch (error) {
      logger.error('Failed to load files', error as Error)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [accessiblePaths])

  /**
   * Handle file selection
   */
  const onSelectFile = useCallback(
    (filePath: string) => {
      const trigger = triggerInfoRef.current
      insertFilePath(filePath, trigger)
      close()
    },
    [close, insertFilePath]
  )

  /**
   * Create file list items for QuickPanel from a file list
   */
  const createFileItems = useCallback(
    (files: string[], loading: boolean = false): QuickPanelListItem[] => {
      if (loading) {
        return [
          {
            label: t('common.loading'),
            description: t('Loading files from accessible directories...'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false
          }
        ]
      }

      if (files.length === 0) {
        return [
          {
            label: t('No files found'),
            description: t('No files available in accessible directories'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false
          }
        ]
      }

      return files.map((filePath) => ({
        label: filePath.split('/').pop() || filePath,
        description: filePath,
        icon: <File size={16} />,
        filterText: filePath,
        action: () => onSelectFile(filePath),
        isSelected: false
      }))
    },
    [onSelectFile, t]
  )

  /**
   * Create file list items for QuickPanel (for current state)
   */
  const fileItems = useMemo<QuickPanelListItem[]>(
    () => createFileItems(fileList, isLoading),
    [createFileItems, fileList, isLoading]
  )

  /**
   * Open QuickPanel with file list
   */
  const openQuickPanel = useCallback(
    async (triggerInfo?: ActivityDirectoryTriggerInfo) => {
      triggerInfoRef.current = triggerInfo

      // Load files if not already loaded
      let files = fileList
      if (files.length === 0) {
        files = await loadFiles()
        setFileList(files)
      }

      // Create items from the loaded files immediately
      const items = createFileItems(files, false)

      open({
        title: t('Select file from activity directory'),
        list: items,
        symbol: QuickPanelReservedSymbol.MentionModels, // Reuse @ symbol
        triggerInfo: triggerInfo || { type: 'button' },
        onClose({ action, searchText, context }) {
          if (action === 'esc') {
            const trigger = context?.triggerInfo ?? triggerInfoRef.current
            if (trigger?.type === 'input' && trigger?.position !== undefined) {
              setText((currentText) => {
                const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                return removeAtSymbolAndText(currentText, caret, searchText || '', trigger?.position!)
              })
            }
          }
          triggerInfoRef.current = undefined
        }
      })
    },
    [createFileItems, fileList, loadFiles, open, removeAtSymbolAndText, setText, t]
  )

  /**
   * Handle button click - toggle panel open/close
   */
  const isMentionPanelActive = useCallback(() => {
    return quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.MentionModels
  }, [quickPanel])

  const handleOpenQuickPanel = useCallback(() => {
    if (isMentionPanelActive()) {
      close()
    } else {
      openQuickPanel({ type: 'button' })
    }
  }, [close, isMentionPanelActive, openQuickPanel])

  /**
   * Update list when files change
   */
  useEffect(() => {
    if (role !== 'manager') return
    if (panelVisible && panelSymbol === QuickPanelReservedSymbol.MentionModels) {
      updateList(fileItems)
    }
  }, [fileItems, panelSymbol, panelVisible, role, updateList])

  /**
   * Register trigger and root menu (manager only)
   */
  useEffect(() => {
    if (role !== 'manager') return

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as ActivityDirectoryTriggerInfo
      openQuickPanel(trigger)
    })

    return () => {
      disposeTrigger()
    }
  }, [openQuickPanel, registerTrigger, role])

  return {
    handleOpenQuickPanel,
    openQuickPanel,
    fileList,
    isLoading
  }
}
