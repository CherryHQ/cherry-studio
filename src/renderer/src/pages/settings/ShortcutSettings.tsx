import { UndoOutlined } from '@ant-design/icons'
import { Button, Input, Kbd, MenuItem, MenuList, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { getAllShortcutDefaultPreferences, useAllShortcuts } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { cn } from '@renderer/utils/style'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutPreferenceKey } from '@shared/shortcuts/types'
import {
  convertKeyToAccelerator,
  formatKeyDisplay,
  formatShortcutDisplay,
  isValidShortcut
} from '@shared/shortcuts/utils'
import { Keyboard, MessageSquareText, Search, Sparkles, Tags, Undo2 } from 'lucide-react'
import type { FC, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsContentBodyClassName,
  settingsContentHeaderClassName,
  settingsContentHeaderTitleClassName,
  settingsContentScrollClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName
} from './shared/menuStyles'

const logger = loggerService.withContext('ShortcutSettings')

const isBindingEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((key, index) => key === b[index])

const keyCodeToAccelerator: Record<string, string> = {
  Backquote: '`',
  Period: '.',
  NumpadEnter: 'Enter',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete'
}

const passthrough =
  /^(Page(Up|Down)|Insert|Home|End|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-9])|Slash|Semicolon|Bracket(Left|Right)|Backslash|Quote|Comma|Minus|Equal)$/

const usableEndKeys = (code: string): string | null => {
  if (/^Key[A-Z]$/.test(code) || /^(Digit|Numpad)\d$/.test(code)) return code.slice(-1)
  if (keyCodeToAccelerator[code]) return keyCodeToAccelerator[code]
  if (passthrough.test(code)) return code
  return null
}

type ShortcutCategoryKey = 'general' | 'chat' | 'topic' | 'assistant'

const categoryIconMap: Record<ShortcutCategoryKey, ReactNode> = {
  general: <Keyboard size={16} />,
  chat: <MessageSquareText size={16} />,
  topic: <Tags size={16} />,
  assistant: <Sparkles size={16} />
}

const definitionCategoryToCategoryKey = (category: string): ShortcutCategoryKey => {
  if (category === 'general') return 'general'
  if (category === 'chat') return 'chat'
  if (category === 'topic') return 'topic'
  return 'assistant'
}

const ShortcutSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { shortcuts, updatePreference } = useAllShortcuts()
  const inputRefs = useRef<Record<string, HTMLInputElement>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const [conflictLabel, setConflictLabel] = useState<string | null>(null)
  const [systemConflictKey, setSystemConflictKey] = useState<ShortcutPreferenceKey | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<ShortcutCategoryKey>('general')
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const categoryMeta = useMemo(
    () => [
      { key: 'general' as const, label: t('settings.shortcuts.categories.general') },
      { key: 'chat' as const, label: t('settings.shortcuts.categories.chat') },
      { key: 'topic' as const, label: t('settings.shortcuts.categories.topic') },
      { key: 'assistant' as const, label: t('settings.shortcuts.categories.assistant') }
    ],
    [t]
  )

  const shortcutsByCategory = useMemo(() => {
    return shortcuts.reduce<Record<ShortcutCategoryKey, typeof shortcuts>>(
      (acc, shortcut) => {
        acc[definitionCategoryToCategoryKey(shortcut.definition.category)].push(shortcut)
        return acc
      },
      { general: [], chat: [], topic: [], assistant: [] }
    )
  }, [shortcuts])

  const currentCategoryShortcuts = shortcutsByCategory[activeCategory]

  const visibleShortcuts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    return currentCategoryShortcuts.filter((record) => {
      if (!query) return true
      const display =
        record.preference.binding.length > 0
          ? formatShortcutDisplay(record.preference.binding, isMac).toLowerCase()
          : ''
      return record.label.toLowerCase().includes(query) || display.includes(query)
    })
  }, [currentCategoryShortcuts, searchQuery])

  const duplicateBindingLabels = useMemo(() => {
    const lookup = new Map<string, { key: ShortcutPreferenceKey; label: string }>()

    for (const shortcut of shortcuts) {
      if (!shortcut.preference.enabled || !shortcut.preference.binding.length) continue
      lookup.set(shortcut.preference.binding.map((key) => key.toLowerCase()).join('+'), {
        key: shortcut.key,
        label: shortcut.label
      })
    }

    return lookup
  }, [shortcuts])

  const clearEditingState = () => {
    clearTimeoutTimer('conflict-clear')
    setEditingKey(null)
    setPendingKeys([])
    setConflictLabel(null)
  }

  const clearSystemConflict = (key?: ShortcutPreferenceKey) => {
    setSystemConflictKey((currentKey) => {
      if (!key || currentKey === key) {
        return null
      }
      return currentKey
    })
  }

  useEffect(() => {
    return window.api.shortcut.onRegistrationConflict(({ key, hasConflict }) => {
      setSystemConflictKey((currentKey) => {
        if (hasConflict) {
          return key
        }
        return currentKey === key ? null : currentKey
      })

      if (hasConflict) {
        window.toast.error(t('settings.shortcuts.occupied_by_other_application'))
      }
    })
  }, [t])

  useEffect(() => {
    if (currentCategoryShortcuts.length === 0) {
      const firstAvailable = categoryMeta.find((category) => shortcutsByCategory[category.key].length > 0)
      if (firstAvailable && firstAvailable.key !== activeCategory) {
        setActiveCategory(firstAvailable.key)
      }
    }
  }, [activeCategory, categoryMeta, currentCategoryShortcuts.length, shortcutsByCategory])

  const handleAddShortcut = (key: ShortcutPreferenceKey) => {
    clearEditingState()
    setEditingKey(key)
    setTimeoutTimer(
      `focus-${key}`,
      () => {
        inputRefs.current[key]?.focus()
      },
      0
    )
  }

  const handleUpdateFailure = (record: (typeof shortcuts)[number], error: unknown) => {
    logger.error(`Failed to update shortcut preference: ${record.key}`, error as Error)
    window.toast.error(t('settings.shortcuts.save_failed_with_name', { name: record.label }))
  }

  const handleResetShortcut = async (record: (typeof shortcuts)[number]) => {
    try {
      clearSystemConflict(record.key)
      await updatePreference(record.key, {
        binding: record.defaultPreference.binding,
        enabled: record.defaultPreference.enabled
      })
      clearEditingState()
    } catch (error) {
      handleUpdateFailure(record, error)
    }
  }

  const findDuplicateLabel = (keys: string[], currentKey: ShortcutPreferenceKey): string | null => {
    const duplicate = duplicateBindingLabels.get(keys.map((key) => key.toLowerCase()).join('+'))
    return duplicate && duplicate.key !== currentKey ? duplicate.label : null
  }

  const handleKeyDown = async (event: ReactKeyboardEvent, record: (typeof shortcuts)[number]) => {
    event.preventDefault()

    if (event.code === 'Escape') {
      clearEditingState()
      return
    }

    const keys: string[] = []

    if (event.ctrlKey) keys.push(isMac ? 'Ctrl' : 'CommandOrControl')
    if (event.altKey) keys.push('Alt')
    if (event.metaKey) keys.push(isMac ? 'CommandOrControl' : 'Meta')
    if (event.shiftKey) keys.push('Shift')

    const endKey = usableEndKeys(event.code)
    if (endKey) {
      keys.push(convertKeyToAccelerator(endKey))
    }

    setPendingKeys(keys)

    if (!isValidShortcut(keys)) {
      setConflictLabel(null)
      return
    }

    const duplicate = findDuplicateLabel(keys, record.key)
    if (duplicate) {
      setConflictLabel(duplicate)
      clearTimeoutTimer('conflict-clear')
      setTimeoutTimer('conflict-clear', () => setConflictLabel(null), 2000)
      return
    }

    setConflictLabel(null)
    try {
      clearSystemConflict(record.key)
      await updatePreference(record.key, { binding: keys, enabled: true })
      clearEditingState()
    } catch (error) {
      handleUpdateFailure(record, error)
    }
  }

  const handleResetAllShortcuts = () => {
    window.modal.confirm({
      title: t('settings.shortcuts.reset_defaults_confirm'),
      centered: true,
      onOk: async () => {
        const updates: Record<string, PreferenceShortcutType> = getAllShortcutDefaultPreferences()

        try {
          clearSystemConflict()
          await preferenceService.setMultiple(updates)
        } catch (error) {
          logger.error('Failed to reset all shortcuts to defaults', error as Error)
          window.toast.error(t('settings.shortcuts.reset_defaults_failed'))
        }
      }
    })
  }

  const handleToggleVisibleShortcuts = async (enabled: boolean) => {
    const updates = visibleShortcuts.reduce(
      (acc, record) => {
        if (!record.preference.binding.length) return acc
        acc[record.key] = {
          binding: record.preference.binding,
          enabled
        }
        return acc
      },
      {} as Record<string, PreferenceShortcutType>
    )

    if (Object.keys(updates).length === 0) return

    try {
      clearSystemConflict()
      await preferenceService.setMultiple(updates)
    } catch (error) {
      logger.error(`Failed to toggle shortcuts for category ${activeCategory}`, error as Error)
      window.toast.error(t('settings.shortcuts.save_failed'))
    }
  }

  const renderShortcutCell = (record: (typeof shortcuts)[number]) => {
    const isEditing = editingKey === record.key
    const displayKeys = record.preference.binding
    const displayShortcut = displayKeys.length > 0 ? formatShortcutDisplay(displayKeys, isMac) : ''
    const isEditable = record.definition.editable !== false
    const isBindingModified = !isBindingEqual(displayKeys, record.defaultPreference.binding)
    const hasSystemConflict = systemConflictKey === record.key
    const conflictMessage =
      conflictLabel ?? (hasSystemConflict ? t('settings.shortcuts.occupied_by_other_application') : null)

    if (isEditing) {
      const pendingDisplay = pendingKeys.length > 0 ? formatShortcutDisplay(pendingKeys, isMac) : ''
      const hasConflict = conflictMessage !== null

      return (
        <div className="relative flex flex-col items-end">
          <Input
            ref={(el) => {
              if (el) inputRefs.current[record.key] = el
            }}
            className={cn(
              'h-8 w-36 rounded-lg border-border/60 bg-background text-center text-sm',
              hasConflict && 'border-red-500 focus-visible:ring-red-500/50'
            )}
            value={pendingDisplay}
            placeholder={t('settings.shortcuts.press_shortcut')}
            onKeyDown={(event) => void handleKeyDown(event, record)}
            onBlur={(event) => {
              const isUndoClick = (event.relatedTarget as HTMLElement)?.closest('.shortcut-undo-icon')
              if (!isUndoClick) {
                clearEditingState()
              }
            }}
          />
          {hasConflict && (
            <span className="absolute top-full right-0 mt-1 whitespace-nowrap text-red-500 text-xs">
              {conflictLabel ? t('settings.shortcuts.conflict_with', { name: conflictLabel }) : conflictMessage}
            </span>
          )}
        </div>
      )
    }

    if (displayShortcut) {
      return (
        <div className="relative flex flex-col items-end">
          <RowFlex className="items-center justify-end gap-2">
            {isBindingModified && (
              <Tooltip content={t('settings.shortcuts.reset_to_default')}>
                <UndoOutlined
                  className="shortcut-undo-icon cursor-pointer text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                  onClick={() => {
                    void handleResetShortcut(record)
                  }}
                />
              </Tooltip>
            )}
            <RowFlex
              className={cn(
                'min-h-9 items-center gap-1 rounded-lg border border-transparent bg-transparent px-2 py-1 transition-colors hover:border-border/60 hover:bg-muted/35',
                hasSystemConflict && 'border-red-500',
                isEditable ? 'cursor-pointer hover:bg-accent/60' : 'cursor-not-allowed opacity-50'
              )}
              onClick={() => isEditable && handleAddShortcut(record.key)}>
              {displayKeys.map((key) => (
                <Kbd
                  key={key}
                  className={cn(
                    'min-w-6 rounded-md border border-border/60 bg-card px-1.5 py-0.75 text-foreground text-xs shadow-none',
                    hasSystemConflict && 'border-red-500/60 text-red-500'
                  )}>
                  {formatKeyDisplay(key, isMac)}
                </Kbd>
              ))}
            </RowFlex>
          </RowFlex>
          {hasSystemConflict && (
            <span className="absolute top-full right-0 mt-1 whitespace-nowrap text-red-500 text-xs">
              {conflictMessage}
            </span>
          )}
        </div>
      )
    }

    return (
      <div className="relative flex flex-col items-end">
        <span
          className={cn(
            'rounded-lg border border-transparent border-dashed bg-transparent px-2.5 py-1.5 text-muted-foreground text-sm transition-colors hover:border-border/60 hover:bg-muted/30',
            hasSystemConflict && 'border-red-500 text-red-500',
            isEditable ? 'cursor-pointer hover:bg-accent/50' : 'cursor-not-allowed opacity-50'
          )}
          onClick={() => isEditable && handleAddShortcut(record.key)}>
          {t('settings.shortcuts.press_shortcut')}
        </span>
        {hasSystemConflict && (
          <span className="absolute top-full right-0 mt-1 whitespace-nowrap text-red-500 text-xs">
            {conflictMessage}
          </span>
        )}
      </div>
    )
  }

  const renderShortcutRow = (record: (typeof shortcuts)[number], isLast: boolean) => {
    const switchNode = (
      <Switch
        size="sm"
        checked={record.preference.enabled}
        disabled={!record.preference.binding.length}
        onCheckedChange={() => {
          clearSystemConflict(record.key)
          updatePreference(record.key, { enabled: !record.preference.enabled }).catch((error) => {
            handleUpdateFailure(record, error)
          })
        }}
      />
    )

    return (
      <div
        key={record.key}
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_14rem_2.5rem] items-center gap-3 py-2.5',
          !record.preference.enabled && 'opacity-60',
          !isLast && 'border-border/50 border-b'
        )}>
        <div className="min-w-0 pr-2">
          <div className="truncate font-medium text-[14px] text-foreground">{record.label}</div>
        </div>
        <div className="flex min-h-9 items-center justify-end">{renderShortcutCell(record)}</div>
        <div className="flex justify-end">
          {!record.preference.binding.length ? (
            <Tooltip content={t('settings.shortcuts.bind_first_to_enable')}>
              <span>{switchNode}</span>
            </Tooltip>
          ) : (
            switchNode
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1" data-theme-mode={theme}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <div className="px-2.5 pt-1 pb-2 font-medium text-foreground-muted text-xs">
              {t('settings.shortcuts.title')}
            </div>
            {categoryMeta.map((category) => {
              const count = shortcutsByCategory[category.key].length
              const isActive = activeCategory === category.key

              return (
                <MenuItem
                  key={category.key}
                  className={settingsSubmenuItemClassName}
                  icon={categoryIconMap[category.key]}
                  active={isActive}
                  label={category.label}
                  suffix={<span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>}
                  onClick={() => {
                    setActiveCategory(category.key)
                    setSearchQuery('')
                  }}
                />
              )
            })}
          </MenuList>
        </Scrollbar>

        <Scrollbar className={settingsContentScrollClassName}>
          <div className={settingsContentBodyClassName}>
            <div className={cn(settingsContentHeaderClassName, 'mb-3 flex items-center justify-between gap-2')}>
              <h1 className={settingsContentHeaderTitleClassName}>
                {categoryMeta.find((item) => item.key === activeCategory)?.label}
              </h1>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs shadow-none"
                  onClick={() => void handleToggleVisibleShortcuts(true)}>
                  {t('settings.shortcuts.all_enable')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs shadow-none"
                  onClick={() => void handleToggleVisibleShortcuts(false)}>
                  {t('settings.shortcuts.all_disable')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-destructive text-xs shadow-none hover:text-destructive"
                  onClick={handleResetAllShortcuts}>
                  <Undo2 size={13} />
                  {t('settings.shortcuts.reset')}
                </Button>
              </div>
            </div>

            <div className="mb-3">
              <div className="relative w-full">
                <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
                <Input
                  className="h-9 w-full rounded-lg border-border/60 bg-background pr-3 pl-9"
                  placeholder={t('settings.shortcuts.search_placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {visibleShortcuts.length > 0 ? (
              <div>
                {visibleShortcuts.map((record, index) =>
                  renderShortcutRow(record, index === visibleShortcuts.length - 1)
                )}
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground text-sm">{t('settings.shortcuts.empty')}</div>
            )}
          </div>
        </Scrollbar>
      </div>
    </div>
  )
}

export default ShortcutSettings
