import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { InstalledSkill } from '@types'
import { Folder, FolderOpen, Zap } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useResourcePanel')
const MAX_FILE_RESULTS = 500
const MAX_SEARCH_RESULTS = 50

/** A single hit from fff — file or directory. Carries enough metadata
 *  to render rich list items and tell entries apart on click. */
interface ResourceEntry {
  type: 'file' | 'directory'
  absolutePath: string
  /** Path relative to the matching `accessiblePaths[i]`. */
  relativePath: string
  name: string
  gitStatus?: string
}

const areEntryListsEqual = (prev: ResourceEntry[], next: ResourceEntry[]) => {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].absolutePath !== next[i].absolutePath || prev[i].type !== next[i].type) return false
  }
  return true
}

export type ResourcePanelTriggerInfo = {
  type: 'input' | 'button'
  position?: number
  originalText?: string
  symbol?: QuickPanelReservedSymbol
}

interface Params {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  agentId?: string
  setText: React.Dispatch<React.SetStateAction<string>>
}

export const useResourcePanel = (params: Params, role: 'button' | 'manager' = 'button') => {
  const { quickPanel, quickPanelController, accessiblePaths, agentId, setText } = params
  const { registerTrigger, registerRootMenu } = quickPanel
  const { open, close, updateList, isVisible, symbol } = quickPanelController
  const { t } = useTranslation()

  const { skills: enabledSkills, loading: skillsLoading } = useInstalledSkills(agentId)

  const [entryList, setEntryList] = useState<ResourceEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const triggerInfoRef = useRef<ResourcePanelTriggerInfo | undefined>(undefined)
  const hasAttemptedLoadRef = useRef(false)
  const entryListRef = useRef<ResourceEntry[]>([])
  /** Set while `handleSearchChange` owns `updateList`; the auto-sync
   *  effect must skip during that window or it'll race-overwrite the
   *  filtered result with the prior, broader list. */
  const searchInFlightRef = useRef(false)

  const updateEntryListState = useCallback((nextEntries: ResourceEntry[]) => {
    if (areEntryListsEqual(entryListRef.current, nextEntries)) {
      return false
    }
    entryListRef.current = nextEntries
    setEntryList(nextEntries)
    return true
  }, [])

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
    (filePath: string, triggerInfo?: ResourcePanelTriggerInfo) => {
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
   * Query fff for files + directories under each accessible path.
   *
   * Uses `window.api.file.findPath` (fff `mixedSearch`) — same engine
   * the AI's `fs__find` tool runs on. Empty / `.` query returns
   * top-frecency entries (browse mode); a real query gets fuzzy +
   * frecency-weighted matches.
   *
   * Multi-root (Session scope): one fff finder per `basePath`. We loop,
   * dedupe by absolute path, and cap at `MAX_FILE_RESULTS`.
   */
  const loadEntries = useCallback(
    async (query: string = '.'): Promise<ResourceEntry[]> => {
      if (accessiblePaths.length === 0) {
        logger.warn('No accessible paths configured')
        return []
      }

      hasAttemptedLoadRef.current = true
      setIsLoading(true)
      const deduped = new Set<string>()
      const collected: ResourceEntry[] = []

      try {
        for (const basePath of accessiblePaths) {
          if (collected.length >= MAX_FILE_RESULTS) break
          if (!basePath) continue
          try {
            const result = await window.api.file.findPath({
              basePath,
              query: query || '.',
              pageSize: MAX_SEARCH_RESULTS
            })
            const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
            for (const item of result.items) {
              const normalizedRel = item.relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
              const absolutePath = `${normalizedBase}/${normalizedRel}`
              if (deduped.has(absolutePath)) continue
              deduped.add(absolutePath)
              collected.push({
                type: item.type,
                absolutePath,
                relativePath: normalizedRel,
                name: item.name,
                gitStatus: item.gitStatus
              })
              if (collected.length >= MAX_FILE_RESULTS) break
            }
          } catch (error) {
            logger.warn(`Failed to search ${basePath}`, error as Error)
          }
        }
        return collected
      } catch (error) {
        logger.error('Failed to load entries', error as Error)
        return []
      } finally {
        setIsLoading(false)
      }
    },
    [accessiblePaths]
  )

  /**
   * Selecting an entry inserts its base-relative path at the trigger
   * position. Files and directories share the same insertion path —
   * the AI sees a path token either way.
   */
  const onSelectEntry = useCallback(
    (entry: ResourceEntry) => {
      insertFilePath(entry.absolutePath, triggerInfoRef.current)
      close()
    },
    [close, insertFilePath]
  )

  /**
   * Insert text at @ position (for skills)
   */
  const insertText = useCallback(
    (text: string, triggerInfo?: ResourcePanelTriggerInfo) => {
      setText((currentText) => {
        const symbolChar = triggerInfo?.symbol ?? QuickPanelReservedSymbol.MentionModels
        const triggerIndex =
          triggerInfo?.position !== undefined
            ? triggerInfo.position
            : symbolChar === QuickPanelReservedSymbol.Root
              ? currentText.lastIndexOf('/')
              : currentText.lastIndexOf('@')

        if (triggerIndex !== -1) {
          let endPos = triggerIndex + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, triggerIndex) + text + ' ' + currentText.slice(endPos)
        }
        return currentText + ' ' + text + ' '
      })
    },
    [setText]
  )

  /**
   * Handle skill selection
   */
  const onSelectSkill = useCallback(
    (skill: InstalledSkill) => {
      const trigger = triggerInfoRef.current
      insertText(skill.name, trigger)
      close()
    },
    [close, insertText]
  )

  /**
   * Build QuickPanel items for an entry list. Files get a per-extension
   * icon; directories get the open-folder icon. `gitStatus` rides into
   * the description so users can spot dirty files at a glance.
   */
  const createEntryItems = useCallback(
    (entries: ResourceEntry[]): QuickPanelListItem[] => {
      return entries.map((entry) => {
        const filterText = `${entry.name} ${entry.relativePath} ${entry.absolutePath}`
        const description =
          entry.gitStatus && entry.gitStatus !== 'clean'
            ? entry.gitStatus
            : entry.type === 'directory'
              ? '/'
              : undefined
        const icon =
          entry.type === 'directory' ? (
            <FolderOpen size={16} />
          ) : (
            <Icon icon={`material-icon-theme:${getFileIconName(entry.absolutePath)}`} style={{ fontSize: 16 }} />
          )

        return {
          label: entry.relativePath || entry.name,
          description,
          icon,
          filterText,
          action: () => onSelectEntry(entry),
          isSelected: false
        }
      })
    },
    [onSelectEntry]
  )

  /**
   * Create skill list items for QuickPanel
   */
  const createSkillItems = useCallback(
    (skillList: InstalledSkill[]): QuickPanelListItem[] => {
      return skillList.map((skill) => ({
        label: skill.name,
        description: skill.description || '',
        icon: <Zap size={16} />,
        filterText: `${skill.name} ${skill.description || ''} ${skill.folderName}`,
        action: () => onSelectSkill(skill),
        isSelected: false
      }))
    },
    [onSelectSkill]
  )

  /**
   * Filter skills by search text
   */
  const filterSkills = useCallback((skillList: InstalledSkill[], searchText: string): InstalledSkill[] => {
    if (!searchText.trim()) return skillList
    const lowerSearch = searchText.toLowerCase()
    return skillList.filter((skill) => {
      const name = skill.name.toLowerCase()
      const desc = (skill.description || '').toLowerCase()
      return name.includes(lowerSearch) || desc.includes(lowerSearch)
    })
  }, [])

  /**
   * Build categorized list with entries (files+dirs) and skills.
   */
  const buildCategorizedList = useCallback(
    (entries: ResourceEntry[], skillList: InstalledSkill[], loading: boolean): QuickPanelListItem[] => {
      if (loading && entries.length === 0 && skillList.length === 0) {
        return [
          {
            label: t('common.loading'),
            description: t('chat.input.resource_panel.loading'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      const items: QuickPanelListItem[] = []

      if (entries.length > 0) {
        items.push({
          label: t('chat.input.resource_panel.categories.files'),
          description: `(${entries.length})`,
          icon: <Folder size={16} />,
          disabled: true,
          action: () => {}
        })
        items.push(...createEntryItems(entries))
      }

      if (skillList.length > 0) {
        items.push({
          label: t('chat.input.resource_panel.categories.skills'),
          description: `(${skillList.length})`,
          icon: <Zap size={16} />,
          disabled: true,
          action: () => {}
        })
        items.push(...createSkillItems(skillList))
      }

      if (items.length === 0) {
        return [
          {
            label: t('chat.input.resource_panel.no_items_found.label'),
            description: t('chat.input.resource_panel.no_items_found.description'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      return items
    },
    [createEntryItems, createSkillItems, t]
  )

  const categorizedItems = useMemo<QuickPanelListItem[]>(
    () => buildCategorizedList(entryList, enabledSkills, isLoading || skillsLoading),
    [buildCategorizedList, entryList, enabledSkills, isLoading, skillsLoading]
  )

  /**
   * Handle search text change — re-query fff and refresh list. We mark
   * `searchInFlightRef` for the duration so the auto-sync effect (which
   * also calls `updateList`) can't race-overwrite the filtered result
   * with stale state during the awaits.
   */
  const handleSearchChange = useCallback(
    async (searchText: string) => {
      logger.debug('Search text changed', { searchText })
      searchInFlightRef.current = true
      try {
        const query = searchText.trim() || '.'
        const newEntries = await loadEntries(query)
        updateEntryListState(newEntries)
        const filteredSkills = filterSkills(enabledSkills, searchText)
        const newItems = buildCategorizedList(newEntries, filteredSkills, false)
        updateList(newItems)
      } finally {
        searchInFlightRef.current = false
      }
    },
    [loadEntries, enabledSkills, filterSkills, buildCategorizedList, updateList, updateEntryListState]
  )

  /**
   * Open QuickPanel with file list
   */
  const openQuickPanel = useCallback(
    async (triggerInfo?: ResourcePanelTriggerInfo) => {
      const normalizedTriggerInfo =
        triggerInfo && triggerInfo.type === 'input'
          ? {
              ...triggerInfo,
              symbol: triggerInfo.symbol ?? QuickPanelReservedSymbol.MentionModels
            }
          : triggerInfo
      triggerInfoRef.current = normalizedTriggerInfo

      // Always load fresh entries when opening the panel
      const entries = await loadEntries()
      updateEntryListState(entries)

      const items = buildCategorizedList(entries, enabledSkills, skillsLoading)

      open({
        title: t('chat.input.resource_panel.description'),
        list: items,
        // Use a dedicated panel symbol — Chat scope also has the
        // MentionModels manager mounted, which would race to overwrite
        // our list if we shared `@` as the panel identifier.
        symbol: QuickPanelReservedSymbol.File,
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
                const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
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
          // Clear entry list and reset state when panel closes
          updateEntryListState([])
          hasAttemptedLoadRef.current = false
          triggerInfoRef.current = undefined
        },
        onSearchChange: handleSearchChange
      })
    },
    [
      loadEntries,
      open,
      removeTriggerSymbolAndText,
      setText,
      t,
      handleSearchChange,
      buildCategorizedList,
      enabledSkills,
      skillsLoading,
      updateEntryListState
    ]
  )

  /**
   * Handle button click - toggle panel open/close
   */
  const isMentionPanelActive = useCallback(() => {
    return quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.File
  }, [quickPanelController])

  const handleOpenQuickPanel = useCallback(() => {
    if (isMentionPanelActive()) {
      close()
    } else {
      void openQuickPanel({ type: 'button' })
    }
  }, [close, isMentionPanelActive, openQuickPanel])

  /**
   * Sync the panel list when async data lands *outside* a search call —
   * for example, skills finishing their async load after the panel
   * already opened. While `handleSearchChange` is running we skip,
   * otherwise its in-flight `setEntryList` / `setIsLoading` would
   * cause this effect to fire mid-call and clobber the filtered list
   * with the prior, broader one.
   */
  useEffect(() => {
    if (role !== 'manager') return
    if (searchInFlightRef.current) return
    if (!hasAttemptedLoadRef.current && entryList.length === 0 && !isLoading) {
      return
    }
    if (isVisible && symbol === QuickPanelReservedSymbol.File) {
      updateList(categorizedItems)
    }
  }, [categorizedItems, entryList.length, enabledSkills.length, isLoading, isVisible, role, symbol, updateList])

  /**
   * Register trigger and root menu (manager only)
   */
  useEffect(() => {
    if (role !== 'manager') return

    const disposeMenu = registerRootMenu([
      {
        label: t('chat.input.resource_panel.title'),
        description: t('chat.input.resource_panel.description'),
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
            void openQuickPanel(rootTrigger ?? { type: 'button' })
          }, 0)
        }
      }
    ])

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as ResourcePanelTriggerInfo
      void openQuickPanel(trigger)
    })

    return () => {
      disposeMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, registerRootMenu, registerTrigger, role, t])

  return {
    handleOpenQuickPanel,
    openQuickPanel,
    entryList,
    isLoading
  }
}
