import { ClearOutlined, UndoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useShortcuts } from '@renderer/hooks/useShortcuts'
import { getShortcutLabel } from '@renderer/i18n/label'
import { useAppDispatch } from '@renderer/store'
import { initialState, resetShortcuts, toggleShortcut, updateShortcut } from '@renderer/store/shortcuts'
import { Shortcut } from '@renderer/types'
import { Button, Input, InputRef, Switch, Table as AntTable, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

const ShortcutSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { shortcuts: originalShortcuts } = useShortcuts()
  const inputRefs = useRef<Record<string, InputRef>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)

  //if shortcut is not available on all the platforms, block the shortcut here
  let shortcuts = originalShortcuts
  if (!isWin && !isMac) {
    //Selection Assistant only available on Windows now
    const excludedShortcuts = ['selection_assistant_toggle', 'selection_assistant_select_text']
    shortcuts = shortcuts.filter((s) => !excludedShortcuts.includes(s.key))
  }

  const handleClear = (record: Shortcut) => {
    dispatch(
      updateShortcut({
        ...record,
        shortcut: []
      })
    )
  }

  const handleAddShortcut = (record: Shortcut) => {
    setEditingKey(record.key)
    setTimeout(() => {
      inputRefs.current[record.key]?.focus()
    }, 0)
  }

  const isShortcutModified = (record: Shortcut) => {
    const defaultShortcut = initialState.shortcuts.find((s) => s.key === record.key)
    return defaultShortcut?.shortcut.join('+') !== record.shortcut.join('+')
  }

  const handleResetShortcut = (record: Shortcut) => {
    const defaultShortcut = initialState.shortcuts.find((s) => s.key === record.key)
    if (defaultShortcut) {
      dispatch(
        updateShortcut({
          ...record,
          shortcut: defaultShortcut.shortcut
        })
      )
    }
  }

  const isValidShortcut = (keys: string[]): boolean => {
    // OLD WAY FOR MODIFIER KEYS, KEEP THEM HERE FOR REFERENCE
    // const hasModifier = keys.some((key) => ['Control', 'Ctrl', 'Command', 'Alt', 'Shift'].includes(key))
    // const hasNonModifier = keys.some((key) => !['Control', 'Ctrl', 'Command', 'Alt', 'Shift'].includes(key))

    // NEW WAY FOR MODIFIER KEYS
    const hasModifier = keys.some((key) => ['CommandOrControl', 'Ctrl', 'Alt', 'Meta', 'Shift'].includes(key))
    const hasNonModifier = keys.some((key) => !['CommandOrControl', 'Ctrl', 'Alt', 'Meta', 'Shift'].includes(key))

    const hasFnKey = keys.some((key) => /^F\d+$/.test(key))

    return (hasModifier && hasNonModifier && keys.length >= 2) || hasFnKey
  }

  const isDuplicateShortcut = (newShortcut: string[], currentKey: string): boolean => {
    return shortcuts.some(
      (s) => s.key !== currentKey && s.shortcut.length > 0 && s.shortcut.join('+') === newShortcut.join('+')
    )
  }

  // how the shortcut is displayed in the UI
  const formatShortcut = (shortcut: string[]): string => {
    return shortcut
      .map((key) => {
        switch (key) {
          // OLD WAY FOR MODIFIER KEYS, KEEP THEM HERE FOR REFERENCE
          // case 'Control':
          //   return isMac ? '⌃' : 'Ctrl'
          // case 'Ctrl':
          //   return isMac ? '⌃' : 'Ctrl'
          // case 'Command':
          //   return isMac ? '⌘' : isWin ? 'Win' : 'Super'
          // case 'Alt':
          //   return isMac ? '⌥' : 'Alt'
          // case 'Shift':
          //   return isMac ? '⇧' : 'Shift'
          // case 'CommandOrControl':
          //   return isMac ? '⌘' : 'Ctrl'

          // new way for modifier keys
          case 'CommandOrControl':
            return isMac ? '⌘' : 'Ctrl'
          case 'Ctrl':
            return isMac ? '⌃' : 'Ctrl'
          case 'Alt':
            return isMac ? '⌥' : 'Alt'
          case 'Meta':
            return isMac ? '⌘' : isWin ? 'Win' : 'Super'
          case 'Shift':
            return isMac ? '⇧' : 'Shift'

          // for backward compatibility with old data
          case 'Command':
          case 'Cmd':
            return isMac ? '⌘' : 'Ctrl'
          case 'Control':
            return isMac ? '⌃' : 'Ctrl'

          case 'ArrowUp':
            return '↑'
          case 'ArrowDown':
            return '↓'
          case 'ArrowLeft':
            return '←'
          case 'ArrowRight':
            return '→'
          case 'Slash':
            return '/'
          case 'Semicolon':
            return ';'
          case 'BracketLeft':
            return '['
          case 'BracketRight':
            return ']'
          case 'Backslash':
            return '\\'
          case 'Quote':
            return "'"
          case 'Comma':
            return ','
          case 'Minus':
            return '-'
          case 'Equal':
            return '='
          default:
            return key.charAt(0).toUpperCase() + key.slice(1)
        }
      })
      .join(' + ')
  }

  const usableEndKeys = (event: React.KeyboardEvent): string | null => {
    const { code } = event
    // No lock keys
    // Among the commonly used keys, not including: Escape, NumpadMultiply, NumpadDivide, NumpadSubtract, NumpadAdd, NumpadDecimal
    // The react-hotkeys-hook library does not differentiate between `Digit` and `Numpad`
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
      case 'Enter':
      case 'Backspace':
      case 'Tab':
      case 'Delete':
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
      // The react-hotkeys-hook library does not handle the symbol strings for the following keys
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

  const handleKeyDown = (e: React.KeyboardEvent, record: Shortcut) => {
    e.preventDefault()

    const keys: string[] = []

    // OLD WAY FOR MODIFIER KEYS, KEEP THEM HERE FOR REFERENCE
    // if (e.ctrlKey) keys.push(isMac ? 'Control' : 'Ctrl')
    // if (e.metaKey) keys.push('Command')
    // if (e.altKey) keys.push('Alt')
    // if (e.shiftKey) keys.push('Shift')

    // NEW WAY FOR MODIFIER KEYS
    // for capability across platforms, we transform the modifier keys to the really meaning keys
    // mainly consider the habit of users on different platforms
    if (e.ctrlKey) keys.push(isMac ? 'Ctrl' : 'CommandOrControl') // for win&linux, ctrl key is almost the same as command key in macOS
    if (e.altKey) keys.push('Alt')
    if (e.metaKey) keys.push(isMac ? 'CommandOrControl' : 'Meta') // for macOS, meta(Command) key is almost the same as Ctrl key in win&linux
    if (e.shiftKey) keys.push('Shift')

    const endKey = usableEndKeys(e)
    if (endKey) {
      keys.push(endKey)
    }

    if (!isValidShortcut(keys)) {
      return
    }

    if (isDuplicateShortcut(keys, record.key)) {
      return
    }

    dispatch(updateShortcut({ ...record, shortcut: keys }))
    setEditingKey(null)
  }

  const handleResetAllShortcuts = () => {
    window.modal.confirm({
      title: t('settings.shortcuts.reset_defaults_confirm'),
      centered: true,
      onOk: () => dispatch(resetShortcuts())
    })
  }

  // 由于启用了showHeader = false，不再需要title字段
  const columns: ColumnsType<Shortcut> = [
    {
      // title: t('settings.shortcuts.action'),
      dataIndex: 'name',
      key: 'name'
    },
    {
      // title: t('settings.shortcuts.label'),
      dataIndex: 'shortcut',
      key: 'shortcut',
      align: 'right',
      render: (shortcut: string[], record: Shortcut) => {
        const isEditing = editingKey === record.key
        const shortcutConfig = shortcuts.find((s) => s.key === record.key)
        const isEditable = shortcutConfig?.editable !== false

        return (
          <HStack style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
            <HStack alignItems="center" style={{ position: 'relative' }}>
              {isEditing ? (
                <ShortcutInput
                  ref={(el) => {
                    if (el) {
                      inputRefs.current[record.key] = el
                    }
                  }}
                  value={formatShortcut(shortcut)}
                  placeholder={t('settings.shortcuts.press_shortcut')}
                  onKeyDown={(e) => handleKeyDown(e, record)}
                  onBlur={(e) => {
                    const isUndoClick = e.relatedTarget?.closest('.shortcut-undo-icon')
                    if (!isUndoClick) {
                      setEditingKey(null)
                    }
                  }}
                />
              ) : (
                <ShortcutText isEditable={isEditable} onClick={() => isEditable && handleAddShortcut(record)}>
                  {shortcut.length > 0 ? formatShortcut(shortcut) : t('settings.shortcuts.press_shortcut')}
                </ShortcutText>
              )}
            </HStack>
          </HStack>
        )
      }
    },
    {
      // title: t('settings.shortcuts.actions'),
      key: 'actions',
      align: 'right',
      width: '70px',
      render: (record: Shortcut) => (
        <HStack style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Tooltip title={t('settings.shortcuts.reset_to_default')}>
            <Button
              icon={<UndoOutlined />}
              size="small"
              shape="circle"
              onClick={() => handleResetShortcut(record)}
              disabled={!isShortcutModified(record)}
            />
          </Tooltip>
          <Tooltip title={t('settings.shortcuts.clear_shortcut')}>
            <Button
              icon={<ClearOutlined />}
              size="small"
              shape="circle"
              onClick={() => handleClear(record)}
              disabled={record.shortcut.length === 0 || !record.editable}
            />
          </Tooltip>
        </HStack>
      )
    },
    {
      // title: t('settings.shortcuts.enabled'),
      key: 'enabled',
      align: 'right',
      width: '50px',
      render: (record: Shortcut) => (
        <Switch size="small" checked={record.enabled} onChange={() => dispatch(toggleShortcut(record.key))} />
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
          dataSource={shortcuts.map((s) => ({ ...s, name: getShortcutLabel(s.key) }))}
          pagination={false}
          size="middle"
          showHeader={false}
        />
        <SettingDivider style={{ marginBottom: 0 }} />
        <HStack justifyContent="flex-end" padding="16px 0">
          <Button onClick={handleResetAllShortcuts}>{t('settings.shortcuts.reset_defaults')}</Button>
        </HStack>
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
