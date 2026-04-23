import { UndoOutlined } from '@ant-design/icons'
import { Button, Input, Kbd, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { getAllShortcutDefaultPreferences, useAllShortcuts } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutPreferenceKey } from '@shared/shortcuts/types'
import {
  convertKeyToAccelerator,
  formatKeyDisplay,
  formatShortcutDisplay,
  isValidShortcut
} from '@shared/shortcuts/utils'
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

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
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const visibleShortcuts = useMemo(() => {
    const query = searchQuery.toLowerCase()
    return shortcuts.filter((record) => {
      if (!query) return true
      const display =
        record.preference.binding.length > 0
          ? formatShortcutDisplay(record.preference.binding, isMac).toLowerCase()
          : ''
      return record.label.toLowerCase().includes(query) || display.includes(query)
    })
  }, [searchQuery, shortcuts])

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

    // Always show real-time preview of pressed keys
    setPendingKeys(keys)

    if (!isValidShortcut(keys)) {
      // Clear conflict when user is still pressing modifier keys
      setConflictLabel(null)
      return
    }

    const duplicate = findDuplicateLabel(keys, record.key)
    if (duplicate) {
      setConflictLabel(duplicate)
      // Clear conflict hint after 2 seconds
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
            className={`h-7 w-36 text-center text-xs ${hasConflict ? 'border-red-500 focus-visible:ring-red-500/50' : ''}`}
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
            <span className="absolute top-full right-0 mt-0.5 whitespace-nowrap text-red-500 text-xs">
              {conflictLabel ? t('settings.shortcuts.conflict_with', { name: conflictLabel }) : conflictMessage}
            </span>
          )}
        </div>
      )
    }

    if (displayShortcut) {
      return (
        <div className="relative flex flex-col items-end">
          <RowFlex className="items-center justify-end gap-1.5">
            {isBindingModified && (
              <Tooltip content={t('settings.shortcuts.reset_to_default')}>
                <UndoOutlined
                  className="mr-1 cursor-pointer opacity-50 hover:opacity-100"
                  onClick={() => {
                    void handleResetShortcut(record)
                  }}
                />
              </Tooltip>
            )}
            <RowFlex
              className={`items-center gap-1 rounded-lg border bg-background-subtle px-2 py-1 ${hasSystemConflict ? 'border-red-500' : 'border-border/40'} ${isEditable ? 'cursor-pointer hover:bg-muted/30' : 'cursor-not-allowed opacity-50'}`}
              onClick={() => isEditable && handleAddShortcut(record.key)}>
              {displayKeys.map((key) => (
                <Kbd
                  key={key}
                  className="min-w-6 rounded-md border border-border/40 bg-background px-1.5 py-0.5 text-foreground text-xs">
                  {formatKeyDisplay(key, isMac)}
                </Kbd>
              ))}
            </RowFlex>
          </RowFlex>
          {hasSystemConflict && (
            <span className="absolute top-full right-0 mt-0.5 whitespace-nowrap text-red-500 text-xs">
              {conflictMessage}
            </span>
          )}
        </div>
      )
    }

    return (
      <div className="relative flex flex-col items-end">
        <span
          className={`rounded-lg border bg-background-subtle px-3 py-1 text-foreground-muted text-sm ${hasSystemConflict ? 'border-red-500' : 'border-border/40'} ${isEditable ? 'cursor-pointer hover:bg-muted/30' : 'cursor-not-allowed opacity-50'}`}
          onClick={() => isEditable && handleAddShortcut(record.key)}>
          {t('settings.shortcuts.press_shortcut')}
        </span>
        {hasSystemConflict && (
          <span className="absolute top-full right-0 mt-0.5 whitespace-nowrap text-red-500 text-xs">
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
        className={`grid grid-cols-[minmax(0,1fr)_14rem_2.5rem] items-center gap-3 py-3.5 ${isLast ? '' : 'border-white/10 border-b'}`}>
        <span className="text-sm">{record.label}</span>
        <div className="flex min-h-8 items-center justify-end">{renderShortcutCell(record)}</div>
        <span className="flex w-10 justify-end">
          {!record.preference.binding.length ? (
            <Tooltip content={t('settings.shortcuts.bind_first_to_enable')}>
              <span className="flex justify-end">{switchNode}</span>
            </Tooltip>
          ) : (
            <span className="flex justify-end">{switchNode}</span>
          )}
        </span>
      </div>
    )
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme} style={{ paddingBottom: 0 }}>
        <SettingTitle>{t('settings.shortcuts.title')}</SettingTitle>
        <SettingDivider style={{ marginBottom: 0 }} />
        <div className="py-2">
          <Input
            className="max-w-65"
            placeholder={t('settings.shortcuts.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          {visibleShortcuts.map((record, index) => renderShortcutRow(record, index === visibleShortcuts.length - 1))}
        </div>
        <SettingDivider style={{ marginBottom: 0 }} />
        <RowFlex className="justify-end p-4">
          <Button onClick={handleResetAllShortcuts}>{t('settings.shortcuts.reset_defaults')}</Button>
        </RowFlex>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ShortcutSettings
