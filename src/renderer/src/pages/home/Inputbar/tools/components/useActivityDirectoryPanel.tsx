import { loggerService } from '@logger'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { File, Folder } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useActivityDirectoryPanel')
const MAX_FILE_RESULTS = 500
const areFileListsEqual = (prev: string[], next: string[]) => {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let index = 0; index < prev.length; index++) {
    if (prev[index] !== next[index]) return false
  }
  return true
}

export type ActivityDirectoryTriggerInfo = {
  type: 'input' | 'button'
  position?: number
  originalText?: string
  symbol?: QuickPanelReservedSymbol
}

interface Params {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

export const useActivityDirectoryPanel = (params: Params, role: 'button' | 'manager' = 'button') => {
  const { quickPanel, quickPanelController, accessiblePaths, setText } = params
  const { registerTrigger, registerRootMenu } = quickPanel
  const { open, close, updateList, isVisible, symbol } = quickPanelController
  const { t } = useTranslation()

  const [fileList, setFileList] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const triggerInfoRef = useRef<ActivityDirectoryTriggerInfo | undefined>(undefined)
  const hasAttemptedLoadRef = useRef(false)
  const fileListRef = useRef<string[]>([])

  const updateFileListState = useCallback(
    (nextFiles: string[]) => {
      if (areFileListsEqual(fileListRef.current, nextFiles)) {
        return false
      }
      fileListRef.current = nextFiles
      setFileList(nextFiles)
      return true
    },
    [setFileList]
  )

  /**
   * Convert absolute file path to relative path based on accessible directories
   */
  const getRelativePath = useCallback(
    (absolutePath: string): string => {
      const normalizedAbsPath = absolutePath.replace(/\\/g, '/')

      // Find the matching accessible path
      for (const basePath of accessiblePaths) {
        const normalizedBasePath = basePath.replace(/\\/g, '/')
        const baseWithSlash = normalizedBasePath.endsWith('/') ? normalizedBasePath : normalizedBasePath + '/'

        if (normalizedAbsPath.startsWith(baseWithSlash)) {
          return normalizedAbsPath.slice(baseWithSlash.length)
        }
        if (normalizedAbsPath === normalizedBasePath) {
          return ''
        }
      }

      // If no match found, return the original path
      return absolutePath
    },
    [accessiblePaths]
  )

  /**
   * Remove trigger symbol (e.g., @ or /) and search text from input
   */
  const removeTriggerSymbolAndText = useCallback(
    (
      currentText: string,
      caretPosition: number,
      symbol: QuickPanelReservedSymbol,
      searchText?: string,
      fallbackPosition?: number
    ) => {
      const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

      if (searchText !== undefined) {
        const pattern = symbol + searchText
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf(pattern, fromIndex)
        if (start !== -1) {
          const end = start + pattern.length
          return currentText.slice(0, start) + currentText.slice(end)
        }

        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === symbol) {
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
      const start = currentText.lastIndexOf(symbol, fromIndex)
      if (start === -1) {
        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === symbol) {
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
      const relativePath = getRelativePath(filePath)
      setText((currentText) => {
        const symbol = triggerInfo?.symbol ?? QuickPanelReservedSymbol.MentionModels
        const triggerIndex =
          triggerInfo?.position !== undefined
            ? triggerInfo.position
            : symbol === QuickPanelReservedSymbol.Root
              ? currentText.lastIndexOf('/')
              : currentText.lastIndexOf('@')

        if (triggerIndex !== -1) {
          let endPos = triggerIndex + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, triggerIndex) + relativePath + ' ' + currentText.slice(endPos)
        }

        // If no trigger found, append at end
        return currentText + ' ' + relativePath + ' '
      })
    },
    [getRelativePath, setText]
  )

  /**
   * Load files from accessible directories
   * @param searchPattern - Optional search pattern to filter files (default: '.')
   */
  const loadFiles = useCallback(
    async (searchPattern: string = '.') => {
      if (accessiblePaths.length === 0) {
        logger.warn('No accessible paths configured')
        return []
      }

      hasAttemptedLoadRef.current = true
      setIsLoading(true)
      const deduped = new Set<string>()
      const collected: string[] = []

      try {
        for (const dirPath of accessiblePaths) {
          if (collected.length >= MAX_FILE_RESULTS) {
            break
          }
          if (!dirPath) continue
          try {
            const files = await window.api.file.listDirectory(dirPath, {
              recursive: true,
              maxDepth: 4,
              includeHidden: false,
              includeFiles: true,
              includeDirectories: true,
              maxEntries: MAX_FILE_RESULTS,
              searchPattern: searchPattern || '.'
            })

            for (const filePath of files) {
              const normalizedPath = filePath.replace(/\\/g, '/')
              if (deduped.has(normalizedPath)) continue
              deduped.add(normalizedPath)
              collected.push(normalizedPath)
              if (collected.length >= MAX_FILE_RESULTS) {
                break
              }
            }
          } catch (error) {
            logger.warn(`Failed to list directory: ${dirPath}`, error as Error)
          }
        }

        return collected
      } catch (error) {
        logger.error('Failed to load files', error as Error)
        return []
      } finally {
        setIsLoading(false)
      }
    },
    [accessiblePaths]
  )

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
      if (loading && files.length === 0) {
        return [
          {
            label: t('common.loading'),
            description: t('chat.input.activity_directory.loading'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      if (files.length === 0) {
        return [
          {
            label: t('chat.input.activity_directory.no_file_found.label'),
            description: t('chat.input.activity_directory.no_file_found.description'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      return files.map((filePath) => {
        const relativePath = getRelativePath(filePath)
        const fileName = relativePath.split('/').pop() || relativePath

        // Include both absolute path and relative path in filterText to improve matching
        // This helps when server-side search returns files with different naming conventions
        // (e.g., "app-updater" vs "appupdater")
        const filterText = `${fileName} ${relativePath} ${filePath}`

        return {
          label: relativePath,
          icon: <File size={16} />,
          filterText: filterText,
          action: () => onSelectFile(filePath),
          isSelected: false
        }
      })
    },
    [getRelativePath, onSelectFile, t]
  )

  /**
   * Create file list items for QuickPanel (for current state)
   */
  const fileItems = useMemo<QuickPanelListItem[]>(
    () => createFileItems(fileList, isLoading),
    [createFileItems, fileList, isLoading]
  )

  /**
   * Handle search text change - load files and update list
   */
  const handleSearchChange = useCallback(
    async (searchText: string) => {
      logger.debug('Search text changed', { searchText })

      // Load files with search pattern
      const searchPattern = searchText.trim() || '.'
      const newFiles = await loadFiles(searchPattern)

      const hasChanged = updateFileListState(newFiles)
      if (hasChanged) {
        const newItems = createFileItems(newFiles, false)
        updateList(newItems)
      }
    },
    [loadFiles, createFileItems, updateList, updateFileListState]
  )

  /**
   * Open QuickPanel with file list
   */
  const openQuickPanel = useCallback(
    async (triggerInfo?: ActivityDirectoryTriggerInfo) => {
      const normalizedTriggerInfo =
        triggerInfo && triggerInfo.type === 'input'
          ? {
              ...triggerInfo,
              symbol: triggerInfo.symbol ?? QuickPanelReservedSymbol.MentionModels
            }
          : triggerInfo
      triggerInfoRef.current = normalizedTriggerInfo

      // Always load fresh files when opening the panel
      const files = await loadFiles()
      updateFileListState(files)

      // Create items from the loaded files immediately
      const items = createFileItems(files, false)

      open({
        title: t('chat.input.activity_directory.description'),
        list: items,
        symbol: QuickPanelReservedSymbol.MentionModels, // Reuse @ symbol
        manageListExternally: true,
        triggerInfo: normalizedTriggerInfo
          ? {
              type: normalizedTriggerInfo.type,
              position: normalizedTriggerInfo.position,
              originalText: normalizedTriggerInfo.originalText
            }
          : { type: 'button' },
        onClose({ action, searchText }) {
          if (action === 'esc') {
            const activeTrigger = triggerInfoRef.current
            if (activeTrigger?.type === 'input' && activeTrigger?.position !== undefined) {
              setText((currentText) => {
                const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                const symbolForRemoval = activeTrigger.symbol ?? QuickPanelReservedSymbol.MentionModels
                return removeTriggerSymbolAndText(
                  currentText,
                  caret,
                  symbolForRemoval,
                  searchText || '',
                  activeTrigger.position
                )
              })
            }
          }
          // Clear file list and reset state when panel closes
          updateFileListState([])
          hasAttemptedLoadRef.current = false
          triggerInfoRef.current = undefined
        },
        onSearchChange: handleSearchChange
      })
    },
    [loadFiles, open, removeTriggerSymbolAndText, setText, t, handleSearchChange, createFileItems, updateFileListState]
  )

  /**
   * Handle button click - toggle panel open/close
   */
  const isMentionPanelActive = useCallback(() => {
    return quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.MentionModels
  }, [quickPanelController])

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
    if (!hasAttemptedLoadRef.current && fileList.length === 0 && !isLoading) {
      return
    }
    if (isVisible && symbol === QuickPanelReservedSymbol.MentionModels) {
      updateList(fileItems)
    }
  }, [fileItems, fileList.length, isLoading, isVisible, role, symbol, updateList])

  /**
   * Register trigger and root menu (manager only)
   */
  useEffect(() => {
    if (role !== 'manager') return

    const disposeMenu = registerRootMenu([
      {
        label: t('chat.input.activity_directory.title'),
        description: t('chat.input.activity_directory.description'),
        icon: <Folder size={16} />,
        isMenu: true,
        action: ({ context }) => {
          const rootTrigger =
            context.triggerInfo && context.triggerInfo.type === 'input'
              ? {
                  ...context.triggerInfo,
                  symbol: QuickPanelReservedSymbol.Root
                }
              : undefined

          context.close('select')
          setTimeout(() => {
            openQuickPanel(rootTrigger ?? { type: 'button' })
          }, 0)
        }
      }
    ])

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as ActivityDirectoryTriggerInfo
      openQuickPanel(trigger)
    })

    return () => {
      disposeMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, registerRootMenu, registerTrigger, role, t])

  return {
    handleOpenQuickPanel,
    openQuickPanel,
    fileList,
    isLoading
  }
}
