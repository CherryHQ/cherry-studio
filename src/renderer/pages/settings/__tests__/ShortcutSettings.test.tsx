import type * as RendererConstantModule from '@renderer/config/constant'
import type { ShortcutListItem } from '@renderer/hooks/command/useCommandShortcuts'
import { type CommandId, commandShortcutPreferenceKey } from '@shared/command'
import type { ShortcutBinding } from '@shared/shortcuts/tokens'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ShortcutSettings from '../ShortcutSettings'

const shortcutsMock = vi.hoisted(() => ({
  shortcuts: [] as ShortcutListItem[],
  updatePreference: vi.fn()
}))

const setTimeoutTimerMock = vi.hoisted(() => vi.fn((_key: string, callback: () => void) => callback()))
const clearTimeoutTimerMock = vi.hoisted(() => vi.fn())
const registrationConflictMock = vi.hoisted(() => vi.fn(() => vi.fn()))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/config/constant', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof RendererConstantModule

  return {
    ...actual,
    isMac: false
  }
})

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: setTimeoutTimerMock,
    clearTimeoutTimer: clearTimeoutTimerMock
  })
}))

vi.mock('@renderer/hooks/command/useCommandShortcuts', () => ({
  getAllShortcutDefaultPreferences: () => ({}),
  useCommandShortcuts: () => ({
    shortcuts: shortcutsMock.shortcuts,
    updatePreference: shortcutsMock.updatePreference
  })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@ant-design/icons', () => ({
  UndoOutlined: ({ onClick, className }: { onClick?: () => void; className?: string }) => (
    <button type="button" className={className} onClick={onClick}>
      undo
    </button>
  )
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Flex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Kbd: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <kbd {...props}>{children}</kbd>,
    MenuItem: ({
      active,
      icon,
      label,
      suffix,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      active?: boolean
      icon?: React.ReactNode
      label: string
      suffix?: React.ReactNode
    }) => {
      void active
      void icon
      return (
        <button type="button" {...props}>
          {label}
          {suffix}
        </button>
      )
    },
    MenuList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    PageHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
    RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Switch: ({
      checked,
      disabled,
      onCheckedChange
    }: {
      checked?: boolean
      disabled?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button type="button" disabled={disabled} aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)}>
        switch
      </button>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

const makeShortcut = (binding: ShortcutBinding = []): ShortcutListItem => {
  const command: CommandId = 'app.search'
  const key = commandShortcutPreferenceKey(command)

  return {
    command,
    key,
    label: 'Search everywhere',
    group: 'general',
    keybinding: {
      command,
      scope: 'renderer',
      preferenceKey: key,
      defaultBinding: ['CommandOrControl', 'Shift', 'F']
    },
    preference: {
      binding,
      enabled: binding.length > 0
    },
    defaultPreference: {
      binding: [],
      enabled: false
    }
  }
}

const renderShortcutSettings = (onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>) =>
  render(
    <div onKeyDown={onKeyDown}>
      <ShortcutSettings />
    </div>
  )

describe('ShortcutSettings shortcut recorder', () => {
  beforeEach(() => {
    shortcutsMock.shortcuts = [makeShortcut()]
    shortcutsMock.updatePreference.mockReset()
    shortcutsMock.updatePreference.mockResolvedValue(undefined)
    setTimeoutTimerMock.mockClear()
    clearTimeoutTimerMock.mockClear()
    registrationConflictMock.mockClear()

    window.api = {
      shortcut: {
        onRegistrationConflict: registrationConflictMock
      }
    } as unknown as typeof window.api
    window.modal = {
      confirm: vi.fn()
    } as unknown as typeof window.modal
    window.toast = {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn()
    } as unknown as typeof window.toast
  })

  it('uses a non-text focus target while recording shortcuts', () => {
    renderShortcutSettings()

    fireEvent.click(screen.getByText('settings.shortcuts.press_shortcut'))

    const recorder = screen.getByRole('button', { name: 'settings.shortcuts.press_shortcut' })
    expect(recorder).toBeInstanceOf(HTMLButtonElement)
    expect(recorder).not.toBeInstanceOf(HTMLInputElement)
    expect(recorder).not.toBeInstanceOf(HTMLTextAreaElement)
  })

  it('records physical key shortcuts and stops propagation while recording', async () => {
    const parentKeyDown = vi.fn()
    renderShortcutSettings(parentKeyDown)

    fireEvent.click(screen.getByText('settings.shortcuts.press_shortcut'))
    const recorder = screen.getByRole('button', { name: 'settings.shortcuts.press_shortcut' })

    fireEvent.keyDown(recorder, { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })

    expect(parentKeyDown).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(shortcutsMock.updatePreference).toHaveBeenCalledWith('shortcut.app.search', {
        binding: ['CommandOrControl', 'K'],
        enabled: true
      })
    })
  })

  it('ignores IME composing keydown while recording', () => {
    renderShortcutSettings()

    fireEvent.click(screen.getByText('settings.shortcuts.press_shortcut'))
    const recorder = screen.getByRole('button', { name: 'settings.shortcuts.press_shortcut' })

    fireEvent.keyDown(recorder, { key: 'Process', code: 'KeyK', ctrlKey: true, bubbles: true })

    expect(shortcutsMock.updatePreference).not.toHaveBeenCalled()
  })
})
