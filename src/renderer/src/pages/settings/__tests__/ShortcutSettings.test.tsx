// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { ShortcutListItem, ShortcutSettingsGroup } from '@renderer/hooks/useShortcuts'
import type { CommandId } from '@shared/commands'
import {
  findKeybindingRule,
  getCommandDefaultShortcutPreference,
  resolveCommandShortcutPreference
} from '@shared/commands'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutBinding } from '@shared/shortcuts/tokens'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { shortcutsMock, updatePreferenceMock, setMultipleMock, toastErrorMock } = vi.hoisted(() => ({
  shortcutsMock: [] as ShortcutListItem[],
  updatePreferenceMock: vi.fn(),
  setMultipleMock: vi.fn(),
  toastErrorMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === 'settings.shortcuts.conflict_with' ? `Conflict with ${String(options?.name)}` : key
  })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  platform: 'win32'
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | undefined | false>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (key: string, callback: () => void) => {
      if (key.startsWith('focus-')) {
        callback()
      }
    },
    clearTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useShortcuts', async () => {
  const actual = await vi.importActual<typeof import('@renderer/hooks/useShortcuts')>('@renderer/hooks/useShortcuts')
  return {
    ...actual,
    useAllShortcuts: () => ({
      shortcuts: shortcutsMock,
      updatePreference: updatePreferenceMock
    })
  }
})

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    setMultiple: setMultipleMock
  }
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Input: ({
      ref,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.RefObject<HTMLInputElement | null> }) => (
      <input {...props} ref={ref} readOnly={props.readOnly ?? (props.value != null && !props.onChange)} />
    ),
    Kbd: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <kbd {...props}>{children}</kbd>,
    MenuItem: ({
      active: _active,
      icon,
      label,
      suffix,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      active?: boolean
      icon?: React.ReactNode
      label: React.ReactNode
      suffix?: React.ReactNode
    }) => (
      <button type="button" {...props}>
        {icon}
        {label}
        {suffix}
      </button>
    ),
    MenuList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Switch: ({
      checked,
      disabled,
      onCheckedChange
    }: {
      checked: boolean
      disabled?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}>
        {checked ? 'on' : 'off'}
      </button>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

import ShortcutSettings from '../ShortcutSettings'

const groupByCommand = (command: CommandId): ShortcutSettingsGroup => {
  if (command.startsWith('chat.')) return 'chat'
  if (command.startsWith('topic.')) return 'topic'
  if (command.startsWith('quick_assistant.') || command.startsWith('selection.')) return 'assistant'
  return 'general'
}

const createShortcut = (
  command: CommandId,
  label: string,
  preferencePatch: Partial<PreferenceShortcutType> = {}
): ShortcutListItem => {
  const keybinding = findKeybindingRule(command)
  if (!keybinding) {
    throw new Error(`Missing test keybinding: ${command}`)
  }

  const defaultPreference = getCommandDefaultShortcutPreference(command)
  const preference = resolveCommandShortcutPreference(command, {
    binding: preferencePatch.binding ?? defaultPreference?.binding ?? [],
    enabled: preferencePatch.enabled ?? defaultPreference?.enabled ?? true
  })

  if (!preference || !defaultPreference) {
    throw new Error(`Missing test preference: ${command}`)
  }

  return {
    command,
    key: keybinding.preferenceKey,
    label,
    group: groupByCommand(command),
    keybinding,
    preference: {
      binding: preference.binding,
      enabled: preference.enabled && preference.binding.length > 0
    },
    defaultPreference
  }
}

const renderShortcutSettings = () => render(<ShortcutSettings />)

const getShortcutRow = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest('.grid')
  if (!row) {
    throw new Error(`Missing shortcut row: ${label}`)
  }
  return row as HTMLElement
}

const startEditingShortcut = (label: string) => {
  const row = getShortcutRow(label)
  fireEvent.click(within(row).getByText('F'))
}

const pressShortcut = (binding: { code: string; key: string; ctrlKey?: boolean; shiftKey?: boolean }) => {
  fireEvent.keyDown(screen.getByPlaceholderText('settings.shortcuts.press_shortcut'), binding)
}

describe('ShortcutSettings keybinding conflicts', () => {
  beforeEach(() => {
    updatePreferenceMock.mockReset()
    setMultipleMock.mockReset()
    toastErrorMock.mockReset()
    window.toast = {
      error: toastErrorMock,
      success: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn()
    } as unknown as typeof window.toast
    window.api = {
      shortcut: {
        onRegistrationConflict: vi.fn(() => vi.fn())
      }
    } as unknown as typeof window.api
  })

  afterEach(() => {
    cleanup()
    shortcutsMock.length = 0
  })

  it('blocks saving a shortcut that conflicts with another enabled command', () => {
    shortcutsMock.push(
      createShortcut('app.search', 'App Search', { binding: ['CommandOrControl', 'Shift', 'F'], enabled: true }),
      createShortcut('chat.message.search', 'Message Search', { binding: ['CommandOrControl', 'F'], enabled: true })
    )

    renderShortcutSettings()
    startEditingShortcut('App Search')
    pressShortcut({ code: 'KeyF', key: 'f', ctrlKey: true })

    expect(updatePreferenceMock).not.toHaveBeenCalled()
    expect(screen.getByText('Conflict with Message Search')).toBeInTheDocument()
  })

  it('allows saving when the matching shortcut is disabled or empty', async () => {
    shortcutsMock.push(
      createShortcut('app.search', 'App Search', { binding: ['CommandOrControl', 'Shift', 'F'], enabled: true }),
      createShortcut('chat.message.search', 'Message Search', { binding: ['CommandOrControl', 'F'], enabled: false }),
      createShortcut('chat.topic.clear', 'Clear Topic', { binding: [], enabled: true })
    )

    renderShortcutSettings()
    startEditingShortcut('App Search')
    pressShortcut({ code: 'KeyF', key: 'f', ctrlKey: true })

    await waitFor(() => {
      expect(updatePreferenceMock).toHaveBeenCalledWith('shortcut.app.search', {
        binding: ['CommandOrControl', 'F'] satisfies ShortcutBinding,
        enabled: true
      })
    })
  })

  it('blocks enabling a shortcut that would conflict', () => {
    shortcutsMock.push(
      createShortcut('app.search', 'App Search', { binding: ['CommandOrControl', 'F'], enabled: false }),
      createShortcut('chat.message.search', 'Message Search', { binding: ['CommandOrControl', 'F'], enabled: true })
    )

    renderShortcutSettings()
    fireEvent.click(within(getShortcutRow('App Search')).getByRole('switch'))

    expect(updatePreferenceMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith('Conflict with Message Search')
  })
})
