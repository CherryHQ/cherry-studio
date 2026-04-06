import { ActionIconButton } from '@renderer/components/Buttons'
import type { QuickPanelListItem, QuickPanelOpenOptions, QuickPanelTriggerInfo } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { useTimer } from '@renderer/hooks/useTimer'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { AttachedSkill, LibrarySkillEntry } from '@renderer/types'
import type { InstalledSkill } from '@types'
import { Tooltip } from 'antd'
import { BookDown, Pin, Sparkles, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  attachedSkills: AttachedSkill[]
  setAttachedSkills: React.Dispatch<React.SetStateAction<AttachedSkill[]>>
  assistantId: string
}

type SkillsTriggerInfo =
  | (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string })
  | undefined

const LIBRARY_CONFIG_KEY = 'skillsLibraryPath'

const sortInstalledSkills = (skills: InstalledSkill[], enabledSet: Set<string>) => {
  return [...skills].sort((a, b) => {
    const aEnabled = enabledSet.has(a.folderName)
    const bEnabled = enabledSet.has(b.folderName)
    if (aEnabled !== bEnabled) return aEnabled ? -1 : 1
    const aName = a.name || a.folderName
    const bName = b.name || b.folderName
    return aName.localeCompare(bName)
  })
}

const getSkillLabel = (entry: InstalledSkill | LibrarySkillEntry) => {
  if ('metadata' in entry) {
    return entry.metadata.name || entry.folderName
  }
  return entry.name || entry.folderName
}

const getPluginErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return fallback
  }

  const message = error.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const SkillsButton = ({
  quickPanel,
  setInputValue,
  resizeTextArea,
  attachedSkills,
  setAttachedSkills,
  assistantId
}: Props) => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()

  const { skills: installedSkills, loading: installedLoading, refresh: refreshInstalled } = useInstalledSkills()

  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)

  const enabledSkills = useMemo(() => assistant.enabledSkills ?? [], [assistant.enabledSkills])
  const enabledSet = useMemo(() => new Set(enabledSkills), [enabledSkills])
  const attachedSet = useMemo(() => new Set(attachedSkills.map((s) => s.folderName)), [attachedSkills])

  const triggerInfoRef = useRef<SkillsTriggerInfo>(undefined)

  const ensureLibraryPath = useCallback(async () => {
    try {
      const existing = (await window.api.config.get(LIBRARY_CONFIG_KEY)) as string | undefined
      if (existing && existing.trim()) {
        setLibraryPath(existing)
        return existing
      }

      const resolved = await window.api.resolvePath('~/skills')
      await window.api.config.set(LIBRARY_CONFIG_KEY, resolved)
      setLibraryPath(resolved)
      return resolved
    } catch (error) {
      // 不阻塞 UI：只记录
      return null
    }
  }, [])

  useEffect(() => {
    void ensureLibraryPath()
  }, [ensureLibraryPath])

  const updateEnabledSkills = useCallback(
    async (nextEnabled: string[]) => {
      updateAssistant({
        ...assistant,
        enabledSkills: nextEnabled
      })
    },
    [assistant, updateAssistant]
  )

  const insertSkillBody = useCallback(
    (body: string) => {
      setTimeoutTimer(
        'insertSkillBody_1',
        () => {
          setInputValue((prev) => {
            const triggerInfo = triggerInfoRef.current
            const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null

            const focusAndSelect = (start: number) => {
              setTimeoutTimer(
                'insertSkillBody_2',
                () => {
                  if (textArea) {
                    textArea.focus()
                    textArea.setSelectionRange(start, start + body.length)
                  }
                  resizeTextArea()
                },
                10
              )
            }

            if (triggerInfo?.type === 'input' && triggerInfo.position !== undefined) {
              const symbol = triggerInfo.symbol ?? QuickPanelReservedSymbol.Root
              const searchText = triggerInfo.searchText ?? ''
              const startIndex = triggerInfo.position

              let endIndex = startIndex + 1
              if (searchText) {
                const expected = symbol + searchText
                const actual = prev.slice(startIndex, startIndex + expected.length)
                if (actual === expected) {
                  endIndex = startIndex + expected.length
                } else {
                  while (endIndex < prev.length && !/\s/.test(prev[endIndex])) {
                    endIndex++
                  }
                }
              } else {
                while (endIndex < prev.length && !/\s/.test(prev[endIndex])) {
                  endIndex++
                }
              }

              const newText = prev.slice(0, startIndex) + body + prev.slice(endIndex)
              triggerInfoRef.current = undefined
              focusAndSelect(startIndex)
              return newText
            }

            if (!textArea) {
              triggerInfoRef.current = undefined
              return prev + body
            }

            const cursorPosition = textArea.selectionStart ?? prev.length
            const newText = prev.slice(0, cursorPosition) + body + prev.slice(cursorPosition)
            triggerInfoRef.current = undefined
            focusAndSelect(cursorPosition)
            return newText
          })
        },
        10
      )
    },
    [resizeTextArea, setInputValue, setTimeoutTimer]
  )

  const handleSelectInstalledSkill = useCallback(
    async (skill: InstalledSkill) => {
      const result = await window.api.skills.readBody({ folderName: skill.folderName })
      if (!result.success) {
        window.toast.error(getPluginErrorMessage(result.error, t('chat.input.skills.errors.read_failed')))
        return
      }
      insertSkillBody(result.data)
      quickPanelHook.close('select')
    },
    [insertSkillBody, quickPanelHook, t]
  )

  const handleImportFromLibrary = useCallback(
    async (skill: LibrarySkillEntry) => {
      const effectivePath = await ensureLibraryPath()
      if (!effectivePath) {
        window.toast.error(t('chat.input.skills.errors.library_not_set'))
        return
      }

      const result = await window.api.skills.importFromLibrary({
        libraryPath: effectivePath,
        skillFolderPath: skill.absolutePath
      })
      if (!result.success) {
        window.toast.error(getPluginErrorMessage(result.error, t('chat.input.skills.errors.import_failed')))
        return
      }
      window.toast.success(t('chat.input.skills.import.success', { name: getSkillLabel(result.data) }))
      await refreshInstalled()
    },
    [ensureLibraryPath, refreshInstalled, t]
  )

  const openInsertPanel = useCallback(
    (triggerInfo?: SkillsTriggerInfo) => {
      triggerInfoRef.current = triggerInfo

      const sorted = sortInstalledSkills(installedSkills, enabledSet)
      const items: QuickPanelListItem[] = sorted.map((entry) => {
        const label = getSkillLabel(entry)
        const description = entry.description || ''
        const isEnabled = enabledSet.has(entry.folderName)
        return {
          label,
          description,
          icon: <Zap size={16} />,
          isSelected: isEnabled,
          filterText: `${label} ${description} ${entry.folderName}`,
          action: () => handleSelectInstalledSkill(entry)
        }
      })

      const options: QuickPanelOpenOptions = {
        title: t('chat.input.skills.insert.title'),
        list: items,
        symbol: QuickPanelReservedSymbol.Skills,
        triggerInfo:
          triggerInfo && triggerInfo.type === 'input'
            ? { type: triggerInfo.type, position: triggerInfo.position, originalText: triggerInfo.originalText }
            : triggerInfo,
        onClose: () => {
          triggerInfoRef.current = undefined
        }
      }

      quickPanelHook.open(options)
    },
    [enabledSet, handleSelectInstalledSkill, installedSkills, quickPanelHook, t]
  )

  const openEnabledPanel = useCallback(() => {
    const items: QuickPanelListItem[] = installedSkills.map((entry) => {
      const label = getSkillLabel(entry)
      const description = entry.description || ''
      const isEnabled = enabledSet.has(entry.folderName)

      return {
        label,
        description,
        icon: <Sparkles size={16} />,
        isSelected: isEnabled,
        filterText: `${label} ${description} ${entry.folderName}`,
        action: async () => {
          const next = new Set(enabledSet)
          if (next.has(entry.folderName)) {
            next.delete(entry.folderName)
          } else {
            next.add(entry.folderName)
          }
          await updateEnabledSkills(Array.from(next))
        }
      }
    })

    quickPanelHook.open({
      title: t('chat.input.skills.enabled.title'),
      list: items,
      symbol: QuickPanelReservedSymbol.Skills,
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [enabledSet, installedSkills, quickPanelHook, t, updateEnabledSkills])

  const openAttachPanel = useCallback(() => {
    const sorted = sortInstalledSkills(installedSkills, attachedSet)
    const items: QuickPanelListItem[] = sorted.map((entry) => {
      const label = getSkillLabel(entry)
      const description = entry.description || ''
      const isAttached = attachedSet.has(entry.folderName)

      return {
        label,
        description,
        icon: <Pin size={16} />,
        isSelected: isAttached,
        filterText: `${label} ${description} ${entry.folderName}`,
        action: async () => {
          setAttachedSkills((prev) => {
            const next = new Map(prev.map((s) => [s.folderName, s]))
            if (next.has(entry.folderName)) {
              next.delete(entry.folderName)
            } else {
              next.set(entry.folderName, {
                folderName: entry.folderName,
                name: entry.name || entry.folderName,
                description: entry.description || undefined
              })
            }
            return Array.from(next.values())
          })
        }
      }
    })

    quickPanelHook.open({
      title: t('chat.input.skills.attach.title'),
      list: items,
      symbol: QuickPanelReservedSymbol.Skills,
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [attachedSet, installedSkills, quickPanelHook, setAttachedSkills, t])

  const openLibraryPanel = useCallback(async () => {
    const effectivePath = await ensureLibraryPath()
    if (!effectivePath) {
      window.toast.error(t('chat.input.skills.errors.library_not_set'))
      return
    }

    setLibraryLoading(true)
    try {
      const result = await window.api.skills.listLibrary({ libraryPath: effectivePath })
      if (!result.success) {
        window.toast.error(getPluginErrorMessage(result.error, t('chat.input.skills.errors.import_failed')))
        return
      }

      const items: QuickPanelListItem[] = result.data.map((entry) => {
        const label = getSkillLabel(entry)
        const description = entry.metadata.description || entry.absolutePath
        return {
          label,
          description,
          icon: <BookDown size={16} />,
          filterText: `${label} ${description} ${entry.folderName}`,
          action: () => handleImportFromLibrary(entry)
        }
      })

      quickPanelHook.open({
        title: t('chat.input.skills.library.title'),
        list: items,
        symbol: QuickPanelReservedSymbol.Skills
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.toast.error(message)
    } finally {
      setLibraryLoading(false)
    }
  }, [ensureLibraryPath, handleImportFromLibrary, quickPanelHook, t])

  const rootMenuItems = useMemo<QuickPanelListItem[]>(
    () => [
      {
        label: t('chat.input.skills.insert.title'),
        description: '',
        icon: <Zap size={16} />,
        isMenu: true,
        action: ({ context, searchText }) => {
          const rootTrigger =
            context.triggerInfo && context.triggerInfo.type === 'input'
              ? {
                  ...context.triggerInfo,
                  symbol: QuickPanelReservedSymbol.Root,
                  searchText: searchText ?? ''
                }
              : undefined
          context.close('select')
          setTimeout(() => openInsertPanel(rootTrigger), 0)
        }
      }
    ],
    [openInsertPanel, t]
  )

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu(rootMenuItems)
    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.Skills, (payload) => {
      const trigger = (payload || undefined) as SkillsTriggerInfo
      openInsertPanel(trigger)
    })

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openInsertPanel, quickPanel, rootMenuItems])

  const openMainPanel = useCallback(() => {
    const items: QuickPanelListItem[] = [
      {
        label: t('chat.input.skills.insert.title'),
        description: t('chat.input.skills.insert.description'),
        icon: <Zap size={16} />,
        isMenu: true,
        action: ({ context }) => {
          context.close('select')
          setTimeout(() => openInsertPanel(), 0)
        }
      },
      {
        label: t('chat.input.skills.attach.title'),
        description: t('chat.input.skills.attach.description', { count: attachedSkills.length }),
        icon: <Pin size={16} />,
        isMenu: true,
        action: ({ context }) => {
          context.close('select')
          setTimeout(() => openAttachPanel(), 0)
        }
      },
      {
        label: t('chat.input.skills.enabled.title'),
        description: t('chat.input.skills.enabled.description'),
        icon: <Sparkles size={16} />,
        isMenu: true,
        action: ({ context }) => {
          context.close('select')
          setTimeout(() => openEnabledPanel(), 0)
        }
      },
      {
        label: t('chat.input.skills.library.title'),
        description: libraryPath ?? t('chat.input.skills.library.not_set'),
        icon: <BookDown size={16} />,
        isMenu: true,
        action: ({ context }) => {
          context.close('select')
          setTimeout(() => openLibraryPanel(), 0)
        }
      }
    ]

    quickPanelHook.open({
      title: t('chat.input.skills.title'),
      list: items,
      symbol: QuickPanelReservedSymbol.Skills
    })
  }, [
    attachedSkills.length,
    libraryPath,
    openAttachPanel,
    openEnabledPanel,
    openInsertPanel,
    openLibraryPanel,
    quickPanelHook,
    t
  ])

  const handleClick = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.Skills) {
      quickPanelHook.close()
    } else {
      openMainPanel()
    }
  }, [openMainPanel, quickPanelHook])

  const loading = installedLoading || libraryLoading
  const tooltipTitle = loading ? t('common.loading') : t('chat.input.skills.title')

  return (
    <Tooltip placement="top" title={tooltipTitle} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleClick} aria-label={t('chat.input.skills.title')} disabled={installedLoading}>
        <Zap size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default memo(SkillsButton)
