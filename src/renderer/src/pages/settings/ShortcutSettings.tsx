import { UndoOutlined } from '@ant-design/icons'
import { Button, Input, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { isMac, platform } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllShortcuts } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { getShortcutLabel } from '@renderer/i18n/label'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutPreferenceKey, SupportedPlatform } from '@shared/shortcuts/types'
import {
  convertKeyToAccelerator,
  formatKeyDisplay,
  formatShortcutDisplay,
  isValidShortcut
} from '@shared/shortcuts/utils'
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

const logger = loggerService.withContext('ShortcutSettings')

type ShortcutRecord = {
  id: string
  label: string
  key: ShortcutPreferenceKey
  enabled: boolean
  editable: boolean
  displayKeys: string[]
  updatePreference: (patch: Partial<PreferenceShortcutType>) => Promise<void>
  defaultPreference: {
    binding: string[]
    enabled: boolean
  }
}

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
  const shortcuts = useAllShortcuts()
  const inputRefs = useRef<Record<string, HTMLInputElement>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const [conflictLabel, setConflictLabel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()

  const displayedShortcuts = useMemo<ShortcutRecord[]>(() => {
    const filtered = shortcuts.filter((item) => {
      const supported = item.definition.supportedPlatforms
      if (supported && platform && !supported.includes(platform as SupportedPlatform)) {
        return false
      }
      return true
    })

    return filtered.map((item) => {
      const label = getShortcutLabel(item.definition.labelKey)

      const displayKeys = item.preference.binding

      return {
        id: item.definition.key,
        label,
        key: item.definition.key,
        enabled: item.preference.enabled,
        editable: item.preference.editable,
        displayKeys,
        updatePreference: item.updatePreference,
        defaultPreference: {
          binding: item.defaultPreference.binding,
          enabled: item.defaultPreference.enabled
        }
      }
    })
  }, [shortcuts])

  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) {
      return displayedShortcuts
    }
    const query = searchQuery.toLowerCase()
    return displayedShortcuts.filter((record) => {
      if (record.label.toLowerCase().includes(query)) {
        return true
      }
      if (record.displayKeys.length > 0) {
        const display = formatShortcutDisplay(record.displayKeys, isMac).toLowerCase()
        if (display.includes(query)) {
          return true
        }
      }
      return false
    })
  }, [displayedShortcuts, searchQuery])

  const handleAddShortcut = (record: ShortcutRecord) => {
    setEditingKey(record.id)
    setPendingKeys([])
    setConflictLabel(null)
    setTimeoutTimer(
      `focus-${record.id}`,
      () => {
        inputRefs.current[record.id]?.focus()
      },
      0
    )
  }

  const isBindingModified = (record: ShortcutRecord) => {
    return !isBindingEqual(record.displayKeys, record.defaultPreference.binding)
  }

  const handleUpdateFailure = (record: ShortcutRecord, error: unknown) => {
    logger.error(`Failed to update shortcut preference: ${record.key}`, error as Error)
    window.toast.error(t('settings.shortcuts.save_failed'))
  }

  const handleResetShortcut = (record: ShortcutRecord) => {
    record.updatePreference({ binding: record.defaultPreference.binding }).catch((error) => {
      handleUpdateFailure(record, error)
    })
    setEditingKey(null)
    setPendingKeys([])
    setConflictLabel(null)
  }

  const findDuplicateLabel = (keys: string[], currentKey: ShortcutPreferenceKey): string | null => {
    const normalized = keys.map((key) => key.toLowerCase()).join('+')

    for (const shortcut of shortcuts) {
      if (shortcut.definition.key === currentKey) continue
      if (!shortcut.preference.enabled) continue
      const binding = shortcut.preference.binding
      if (!binding.length) continue
      if (binding.map((key) => key.toLowerCase()).join('+') === normalized) {
        return getShortcutLabel(shortcut.definition.labelKey)
      }
    }
    return null
  }

  const handleKeyDown = (event: ReactKeyboardEvent, record: ShortcutRecord) => {
    event.preventDefault()

    if (event.code === 'Escape') {
      setEditingKey(null)
      setPendingKeys([])
      setConflictLabel(null)
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
    record.updatePreference({ binding: keys }).catch((error) => {
      handleUpdateFailure(record, error)
    })
    setEditingKey(null)
    setPendingKeys([])
  }

  const handleResetAllShortcuts = () => {
    window.modal.confirm({
      title: t('settings.shortcuts.reset_defaults_confirm'),
      centered: true,
      onOk: async () => {
        const updates: Record<string, PreferenceShortcutType> = {}

        shortcuts.forEach((item) => {
          updates[item.definition.key] = {
            binding: item.defaultPreference.binding,
            enabled: item.defaultPreference.enabled
          }
        })

        try {
          await preferenceService.setMultiple(updates)
        } catch (error) {
          logger.error('Failed to reset all shortcuts to defaults', error as Error)
          window.toast.error(t('settings.shortcuts.reset_defaults_failed'))
        }
      }
    })
  }

  const renderShortcutCell = (record: ShortcutRecord) => {
    const isEditing = editingKey === record.id
    const displayShortcut = record.displayKeys.length > 0 ? formatShortcutDisplay(record.displayKeys, isMac) : ''

    if (isEditing) {
      const pendingDisplay = pendingKeys.length > 0 ? formatShortcutDisplay(pendingKeys, isMac) : ''
      const hasConflict = conflictLabel !== null

      return (
        <div className="relative flex flex-col items-end">
          <Input
            ref={(el) => {
              if (el) inputRefs.current[record.id] = el
            }}
            className={`h-7 w-36 text-center text-xs ${hasConflict ? 'border-red-500 focus-visible:ring-red-500/50' : ''}`}
            value={pendingDisplay}
            placeholder={t('settings.shortcuts.press_shortcut')}
            onKeyDown={(event) => handleKeyDown(event, record)}
            onBlur={(event) => {
              const isUndoClick = (event.relatedTarget as HTMLElement)?.closest('.shortcut-undo-icon')
              if (!isUndoClick) {
                clearTimeoutTimer('conflict-clear')
                setEditingKey(null)
                setPendingKeys([])
                setConflictLabel(null)
              }
            }}
          />
          {hasConflict && (
            <span className="absolute top-full right-0 mt-0.5 whitespace-nowrap text-red-500 text-xs">
              {t('settings.shortcuts.conflict_with', { name: conflictLabel })}
            </span>
          )}
        </div>
      )
    }

    if (displayShortcut) {
      return (
        <RowFlex className="items-center justify-end gap-1.5">
          {isBindingModified(record) && (
            <Tooltip content={t('settings.shortcuts.reset_to_default')}>
              <UndoOutlined
                className="mr-1 cursor-pointer opacity-50 hover:opacity-100"
                onClick={() => handleResetShortcut(record)}
              />
            </Tooltip>
          )}
          <RowFlex
            className={`items-center gap-1 rounded-lg bg-white/5 px-2 py-1 ${record.editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            onClick={() => record.editable && handleAddShortcut(record)}>
            {record.displayKeys.map((key) => (
              <kbd
                key={key}
                className="flex min-w-6 items-center justify-center rounded-md bg-white/10 px-1.5 py-0.5 text-xs">
                {formatKeyDisplay(key, isMac)}
              </kbd>
            ))}
          </RowFlex>
        </RowFlex>
      )
    }

    return (
      <span
        className={`rounded-lg bg-white/5 px-3 py-1 text-sm text-white/30 ${record.editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
        onClick={() => record.editable && handleAddShortcut(record)}>
        {t('settings.shortcuts.press_shortcut')}
      </span>
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
          {filteredShortcuts.map((record, index) => (
            <div
              key={record.id}
              className={`flex items-center justify-between py-3.5 ${index < filteredShortcuts.length - 1 ? 'border-white/10 border-b' : ''}`}>
              <span className="text-sm">{record.label}</span>
              <RowFlex className="items-center gap-3">
                {renderShortcutCell(record)}
                {record.displayKeys.length > 0 && (
                  <Switch
                    size="sm"
                    checked={record.enabled}
                    onCheckedChange={() => {
                      record.updatePreference({ enabled: !record.enabled }).catch((error) => {
                        handleUpdateFailure(record, error)
                      })
                    }}
                  />
                )}
              </RowFlex>
            </div>
          ))}
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
