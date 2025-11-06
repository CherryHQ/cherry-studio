import { ClearOutlined, UndoOutlined } from '@ant-design/icons'
import { Button, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllShortcuts } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { getShortcutLabel } from '@renderer/i18n/label'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutPreferenceKey } from '@shared/shortcuts/types'
import { convertKeyToAccelerator, formatShortcutDisplay, isValidShortcut } from '@shared/shortcuts/utils'
import type { InputRef } from 'antd'
import { Input, Table as AntTable } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

const labelKeyMap: Record<string, string> = {
  'shortcut.app.show_main_window': 'show_app',
  'shortcut.app.show_mini_window': 'mini_window',
  'shortcut.app.show_settings': 'show_settings',
  'shortcut.app.toggle_show_assistants': 'toggle_show_assistants',
  'shortcut.app.exit_fullscreen': 'exit_fullscreen',
  'shortcut.app.zoom_in': 'zoom_in',
  'shortcut.app.zoom_out': 'zoom_out',
  'shortcut.app.zoom_reset': 'zoom_reset',
  'shortcut.app.search_message': 'search_message',
  'shortcut.chat.clear': 'clear_topic',
  'shortcut.chat.search_message': 'search_message_in_chat',
  'shortcut.chat.toggle_new_context': 'toggle_new_context',
  'shortcut.chat.copy_last_message': 'copy_last_message',
  'shortcut.chat.edit_last_user_message': 'edit_last_user_message',
  'shortcut.topic.new': 'new_topic',
  'shortcut.topic.rename': 'rename_topic',
  'shortcut.topic.toggle_show_topics': 'toggle_show_topics',
  'shortcut.selection.toggle_enabled': 'selection_assistant_toggle',
  'shortcut.selection.get_text': 'selection_assistant_select_text'
}

type ShortcutRecord = {
  id: string
  label: string
  key: ShortcutPreferenceKey
  enabled: boolean
  editable: boolean
  displayKeys: string[]
  rawKeys: string[]
  hasCustomBinding: boolean
  system: boolean
  updatePreference: (patch: Partial<PreferenceShortcutType>) => Promise<void>
  defaultPreference: {
    binding: string[]
    enabled: boolean
  }
}

const ShortcutSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const shortcuts = useAllShortcuts()
  const inputRefs = useRef<Record<string, InputRef>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const { setTimeoutTimer } = useTimer()

  const displayedShortcuts = useMemo<ShortcutRecord[]>(() => {
    const filtered = !isWin && !isMac ? shortcuts.filter((item) => item.definition.category !== 'selection') : shortcuts

    return filtered.map((item) => {
      const labelKey = labelKeyMap[item.definition.key] ?? item.definition.key
      const label = getShortcutLabel(labelKey)

      const displayKeys = item.preference.hasCustomBinding
        ? item.preference.rawBinding
        : item.preference.binding.length > 0
          ? item.preference.binding
          : item.definition.defaultKey

      return {
        id: item.definition.key,
        label,
        key: item.definition.key,
        enabled: item.preference.enabled,
        editable: item.preference.editable,
        displayKeys,
        rawKeys: item.preference.rawBinding,
        hasCustomBinding: item.preference.hasCustomBinding,
        system: item.preference.system,
        updatePreference: item.updatePreference,
        defaultPreference: {
          binding: item.defaultPreference.binding,
          enabled: item.defaultPreference.enabled
        }
      }
    })
  }, [shortcuts])

  const handleClear = (record: ShortcutRecord) => {
    void record.updatePreference({ key: [] })
  }

  const handleAddShortcut = (record: ShortcutRecord) => {
    setEditingKey(record.id)
    setTimeoutTimer(
      `focus-${record.id}`,
      () => {
        inputRefs.current[record.id]?.focus()
      },
      0
    )
  }

  const isShortcutModified = (record: ShortcutRecord) => {
    const bindingChanged = record.hasCustomBinding
      ? record.rawKeys.length !== record.defaultPreference.binding.length ||
        record.rawKeys.some((key, index) => key !== record.defaultPreference.binding[index])
      : false

    const enabledChanged = record.enabled !== record.defaultPreference.enabled

    return bindingChanged || enabledChanged
  }

  const handleResetShortcut = (record: ShortcutRecord) => {
    void record.updatePreference({
      key: record.defaultPreference.binding,
      enabled: record.defaultPreference.enabled
    })
    setEditingKey(null)
  }

  const isDuplicateShortcut = (keys: string[], currentKey: ShortcutPreferenceKey) => {
    const normalized = keys.map((key) => key.toLowerCase()).join('+')

    return displayedShortcuts.some((record) => {
      if (record.key === currentKey) return false
      const binding = record.displayKeys
      if (!binding.length) return false
      return binding.map((key) => key.toLowerCase()).join('+') === normalized
    })
  }

  const usableEndKeys = (event: ReactKeyboardEvent): string | null => {
    const { code } = event
    switch (code) {
      case 'KeyA':
      case 'KeyB':
      case 'KeyC':
      case 'KeyD':
      case 'KeyE':
      case 'KeyF':
      case 'KeyG':
      case 'KeyH':
      case 'KeyI':
      case 'KeyJ':
      case 'KeyK':
      case 'KeyL':
      case 'KeyM':
      case 'KeyN':
      case 'KeyO':
      case 'KeyP':
      case 'KeyQ':
      case 'KeyR':
      case 'KeyS':
      case 'KeyT':
      case 'KeyU':
      case 'KeyV':
      case 'KeyW':
      case 'KeyX':
      case 'KeyY':
      case 'KeyZ':
      case 'Digit0':
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9':
      case 'Numpad0':
      case 'Numpad1':
      case 'Numpad2':
      case 'Numpad3':
      case 'Numpad4':
      case 'Numpad5':
      case 'Numpad6':
      case 'Numpad7':
      case 'Numpad8':
      case 'Numpad9':
        return code.slice(-1)
      case 'Space':
        return 'Space'
      case 'Enter':
        return 'Enter'
      case 'Backspace':
        return 'Backspace'
      case 'Tab':
        return 'Tab'
      case 'Delete':
        return 'Delete'
      case 'PageUp':
      case 'PageDown':
      case 'Insert':
      case 'Home':
      case 'End':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'F1':
      case 'F2':
      case 'F3':
      case 'F4':
      case 'F5':
      case 'F6':
      case 'F7':
      case 'F8':
      case 'F9':
      case 'F10':
      case 'F11':
      case 'F12':
      case 'F13':
      case 'F14':
      case 'F15':
      case 'F16':
      case 'F17':
      case 'F18':
      case 'F19':
        return code
      case 'Backquote':
        return '`'
      case 'Period':
        return '.'
      case 'NumpadEnter':
        return 'Enter'
      case 'Slash':
      case 'Semicolon':
      case 'BracketLeft':
      case 'BracketRight':
      case 'Backslash':
      case 'Quote':
      case 'Comma':
      case 'Minus':
      case 'Equal':
        return code
      default:
        return null
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent, record: ShortcutRecord) => {
    event.preventDefault()

    const keys: string[] = []

    if (event.ctrlKey) keys.push(isMac ? 'Ctrl' : 'CommandOrControl')
    if (event.altKey) keys.push('Alt')
    if (event.metaKey) keys.push(isMac ? 'CommandOrControl' : 'Meta')
    if (event.shiftKey) keys.push('Shift')

    const endKey = usableEndKeys(event)
    if (endKey) {
      keys.push(convertKeyToAccelerator(endKey))
    }

    if (!isValidShortcut(keys)) {
      return
    }

    if (isDuplicateShortcut(keys, record.key)) {
      return
    }

    void record.updatePreference({ key: keys })
    setEditingKey(null)
  }

  const handleResetAllShortcuts = () => {
    window.modal.confirm({
      title: t('settings.shortcuts.reset_defaults_confirm'),
      centered: true,
      onOk: async () => {
        const updates: Record<string, PreferenceShortcutType> = {}

        shortcuts.forEach((item) => {
          updates[item.definition.key] = {
            key: item.defaultPreference.binding,
            enabled: item.defaultPreference.enabled,
            editable: item.defaultPreference.editable,
            system: item.defaultPreference.system
          }
        })

        await preferenceService.setMultiple(updates)
      }
    })
  }

  const columns: ColumnsType<ShortcutRecord> = [
    {
      dataIndex: 'label',
      key: 'label'
    },
    {
      dataIndex: 'displayKeys',
      key: 'shortcut',
      align: 'right',
      render: (_value, record) => {
        const isEditing = editingKey === record.id
        const displayShortcut = record.displayKeys.length > 0 ? formatShortcutDisplay(record.displayKeys, isMac) : ''
        const editingShortcut = record.rawKeys.length > 0 ? formatShortcutDisplay(record.rawKeys, isMac) : ''

        return (
          <RowFlex className="items-center justify-end gap-2">
            <RowFlex className="relative items-center">
              {isEditing ? (
                <ShortcutInput
                  ref={(element) => {
                    if (element) {
                      inputRefs.current[record.id] = element
                    }
                  }}
                  value={editingShortcut}
                  placeholder={t('settings.shortcuts.press_shortcut')}
                  onKeyDown={(event) => handleKeyDown(event, record)}
                  onBlur={(event) => {
                    const isUndoClick = event.relatedTarget?.closest('.shortcut-undo-icon')
                    if (!isUndoClick) {
                      setEditingKey(null)
                    }
                  }}
                />
              ) : (
                <ShortcutText isEditable={record.editable} onClick={() => record.editable && handleAddShortcut(record)}>
                  {displayShortcut || t('settings.shortcuts.press_shortcut')}
                </ShortcutText>
              )}
            </RowFlex>
          </RowFlex>
        )
      }
    },
    {
      key: 'actions',
      align: 'right',
      width: 70,
      render: (record) => (
        <RowFlex className="items-center justify-end gap-2">
          <Tooltip content={t('settings.shortcuts.reset_to_default')}>
            <Button size="icon-sm" onClick={() => handleResetShortcut(record)} disabled={!isShortcutModified(record)}>
              <UndoOutlined />
            </Button>
          </Tooltip>
          <Tooltip content={t('settings.shortcuts.clear_shortcut')}>
            <Button
              size="icon-sm"
              onClick={() => handleClear(record)}
              disabled={record.rawKeys.length === 0 || !record.editable}>
              <ClearOutlined />
            </Button>
          </Tooltip>
        </RowFlex>
      )
    },
    {
      key: 'enabled',
      align: 'right',
      width: 50,
      render: (record) => (
        <Switch
          size="sm"
          isSelected={record.enabled}
          onValueChange={() => void record.updatePreference({ enabled: !record.enabled })}
        />
      )
    }
  ]

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme} style={{ paddingBottom: 0 }}>
        <SettingTitle>{t('settings.shortcuts.title')}</SettingTitle>
        <SettingDivider style={{ marginBottom: 0 }} />
        <Table
          columns={columns as ColumnsType<unknown>}
          dataSource={displayedShortcuts}
          pagination={false}
          size="middle"
          showHeader={false}
          rowKey="id"
        />
        <SettingDivider style={{ marginBottom: 0 }} />
        <RowFlex className="justify-end p-4">
          <Button onClick={handleResetAllShortcuts}>{t('settings.shortcuts.reset_defaults')}</Button>
        </RowFlex>
      </SettingGroup>
    </SettingContainer>
  )
}

const Table = styled(AntTable)`
  .ant-table {
    background: transparent;
  }

  .ant-table-cell {
    padding: 14px 0 !important;
    background: transparent !important;
  }

  .ant-table-tbody > tr:last-child > td {
    border-bottom: none;
  }
`

const ShortcutInput = styled(Input)`
  width: 120px;
  text-align: center;
`

const ShortcutText = styled.span<{ isEditable: boolean }>`
  cursor: ${({ isEditable }) => (isEditable ? 'pointer' : 'not-allowed')};
  padding: 4px 11px;
  opacity: ${({ isEditable }) => (isEditable ? 1 : 0.5)};
`

export default ShortcutSettings
