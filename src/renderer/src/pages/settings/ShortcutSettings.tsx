import { ClearOutlined, UndoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { isMac, isWindows } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useShortcuts } from '@renderer/hooks/useShortcuts'
import { useAppDispatch } from '@renderer/store'
import { initialState, resetShortcuts, toggleShortcut, updateShortcut } from '@renderer/store/shortcuts'
import { Shortcut } from '@renderer/types'
import { Button, Input, InputRef, Switch, Table as AntTable, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

const ShortcutSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { shortcuts } = useShortcuts()
  const inputRefs = useRef<Record<string, InputRef>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)

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
    const hasModifier = keys.some((key) => ['Control', 'Ctrl', 'Command', 'Alt', 'Shift'].includes(key))
    const hasNonModifier = keys.some((key) => !['Control', 'Ctrl', 'Command', 'Alt', 'Shift'].includes(key))

    if (isMac && keys.includes('Alt')) {
      window.message.warning({
        content: t('settings.shortcuts.alt_warning'),
        key: 'shortcut-alt-warning'
      })
      return false
    }

    return hasModifier && hasNonModifier && keys.length >= 2
  }

  const isDuplicateShortcut = (newShortcut: string[], currentKey: string): boolean => {
    return shortcuts.some(
      (s) => s.key !== currentKey && s.shortcut.length > 0 && s.shortcut.join('+') === newShortcut.join('+')
    )
  }

  const formatShortcut = (shortcut: string[]): string => {
    return shortcut
      .map((key) => {
        switch (key) {
          case 'Control':
            return isMac ? '⌃' : 'Ctrl'
          case 'Ctrl':
            return isMac ? '⌃' : 'Ctrl'
          case 'Command':
            return isMac ? '⌘' : isWindows ? 'Win' : 'Super'
          case 'Alt':
            return isMac ? '⌥' : 'Alt'
          case 'Shift':
            return isMac ? '⇧' : 'Shift'
          case 'CommandOrControl':
            return isMac ? '⌘' : 'Ctrl'
          case ' ':
            return 'Space'
          default:
            return key.charAt(0).toUpperCase() + key.slice(1)
        }
      })
      .join(' + ')
  }

  const handleKeyDown = (e: React.KeyboardEvent, record: Shortcut) => {
    e.preventDefault()

    const keys: string[] = []
    if (e.ctrlKey) keys.push(isMac ? 'Control' : 'Ctrl')
    if (e.metaKey) keys.push('Command')
    if (e.altKey) keys.push('Alt')
    if (e.shiftKey) keys.push('Shift')

    const key = e.key

    if (key.length === 1 && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      if (key === ' ') {
        keys.push('Space')
      } else {
        keys.push(key.toUpperCase())
      }
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

  const columns: ColumnsType<Shortcut> = [
    {
      title: t('settings.shortcuts.action'),
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: t('settings.shortcuts.key'),
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
                  ref={(el) => el && (inputRefs.current[record.key] = el)}
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
      title: t('settings.shortcuts.actions'),
      key: 'actions',
      align: 'right',
      width: '70px',
      render: (record: Shortcut) => (
        <HStack style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Tooltip title={t('settings.shortcuts.reset_to_default')}>
            <Button
              icon={<UndoOutlined />}
              size="small"
              onClick={() => handleResetShortcut(record)}
              disabled={!isShortcutModified(record)}
            />
          </Tooltip>
          <Tooltip title={t('settings.shortcuts.clear_shortcut')}>
            <Button
              icon={<ClearOutlined />}
              size="small"
              onClick={() => handleClear(record)}
              disabled={record.shortcut.length === 0 || !record.editable}
            />
          </Tooltip>
        </HStack>
      )
    },
    {
      title: t('settings.shortcuts.enabled'),
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
          dataSource={shortcuts.map((s) => ({ ...s, name: t(`settings.shortcuts.${s.key}`) }))}
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
