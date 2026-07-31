import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShortcutListItem } from '@renderer/hooks/command/useCommandShortcuts'
import type * as RendererConstantModule from '@renderer/utils/platform'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { type CommandId, commandShortcutPreferenceKey } from '@shared/utils/command'
import type { ShortcutBinding } from '@shared/utils/shortcut'

import ShortcutSettings from '../ShortcutSettings'

const shortcutsMock = vi.hoisted(() => ({
  shortcuts: [] as ShortcutListItem[],
  updatePreference: vi.fn()
}))

const setTimeoutTimerMock = vi.hoisted(() => vi.fn((_key: string, callback: () => void) => callback()))
const clearTimeoutTimerMock = vi.hoisted(() => vi.fn())
const registrationConflictMock = vi.hoisted(() => vi.fn(() => vi.fn()))
const preferenceServiceSetMultipleMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

// The page reads `?command=<id>` to focus one row; rendered without a router, the real hook
// throws. Tests set this to choose which row (if any) arrives focused.
const { routerSearch } = vi.hoisted(() => ({ routerSearch: { current: {} as { command?: string } } }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerSearch.current
}))

// jsdom ships no scrollIntoView, and the focused row calls it on mount.
Element.prototype.scrollIntoView = vi.fn()

vi.mock('@renderer/utils/platform', async (importOriginal) => {
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

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    setMultiple: preferenceServiceSetMultipleMock
  }
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
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

const makeShortcut = ({
  command = 'app.search',
  binding = [],
  enabled = binding.length > 0,
  defaultPreference = { binding: [], enabled: false },
  label = 'Search everywhere'
}: {
  command?: CommandId
  binding?: ShortcutBinding
  enabled?: boolean
  defaultPreference?: PreferenceShortcutType
  label?: string
} = {}): ShortcutListItem => {
  const key = commandShortcutPreferenceKey(command)

  return {
    command,
    key,
    label,
    group: 'general',
    keybinding: {
      command,
      scope: 'renderer',
      preferenceKey: key,
      defaultBinding: ['CommandOrControl', 'Shift', 'F']
    },
    preference: {
      binding,
      enabled
    },
    defaultPreference
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
    routerSearch.current = {}
    shortcutsMock.shortcuts = [makeShortcut()]
    shortcutsMock.updatePreference.mockReset()
    shortcutsMock.updatePreference.mockResolvedValue(undefined)
    preferenceServiceSetMultipleMock.mockReset()
    preferenceServiceSetMultipleMock.mockResolvedValue(undefined)
    setTimeoutTimerMock.mockClear()
    clearTimeoutTimerMock.mockClear()
    registrationConflictMock.mockClear()

    window.api = {
      shortcut: {
        onRegistrationConflict: registrationConflictMock
      }
    } as unknown as typeof window.api
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

    fireEvent.keyDown(recorder, { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true })

    expect(parentKeyDown).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(shortcutsMock.updatePreference).toHaveBeenCalledWith('shortcut.app.search', {
        binding: ['CommandOrControl', 'Shift', 'K'],
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

  it('resets a shortcut to the platform-resolved default binding', async () => {
    const defaultPreference: PreferenceShortcutType = { binding: ['Ctrl', 'Tab'], enabled: true }
    shortcutsMock.shortcuts = [
      makeShortcut({
        command: 'tab.next',
        binding: ['CommandOrControl', 'Alt', 'Tab'],
        enabled: true,
        defaultPreference
      })
    ]

    const { container } = renderShortcutSettings()

    const resetButton = container.querySelector('.shortcut-undo-icon')
    expect(resetButton).not.toBeNull()
    fireEvent.click(resetButton as Element)

    await waitFor(() => {
      expect(shortcutsMock.updatePreference).toHaveBeenCalledWith('shortcut.tab.next', defaultPreference)
    })
  })

  it('bulk toggles shortcuts using the platform-resolved binding', async () => {
    const user = userEvent.setup()
    shortcutsMock.shortcuts = [
      makeShortcut({
        command: 'tab.next',
        binding: ['Ctrl', 'Tab'],
        enabled: true,
        defaultPreference: { binding: ['Ctrl', 'Tab'], enabled: true }
      })
    ]

    renderShortcutSettings()

    await user.click(screen.getByRole('button', { name: 'common.more' }))
    await user.click(await screen.findByRole('menuitem', { name: 'settings.shortcuts.all_disable' }))

    await waitFor(() => {
      expect(preferenceServiceSetMultipleMock).toHaveBeenCalledWith({
        'shortcut.tab.next': { binding: ['Ctrl', 'Tab'], enabled: false }
      })
    })
  })

  it('clears the search when switching shortcut categories', async () => {
    const user = userEvent.setup()
    shortcutsMock.shortcuts = [
      makeShortcut({ label: 'Search everywhere' }),
      { ...makeShortcut({ command: 'tab.next', label: 'Next chat' }), group: 'chat' }
    ]

    renderShortcutSettings()

    await user.click(screen.getByRole('button', { name: 'common.search' }))
    const search = screen.getByRole('searchbox', { name: 'common.search' })
    await user.type(search, 'Search')
    await user.click(screen.getByRole('button', { name: /settings.shortcuts.categories.all/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: /settings.shortcuts.categories.chat/ }))

    expect(search).toHaveValue('')
    expect(screen.getByText('Next chat')).toBeInTheDocument()
  })

  // Pages that own a feature but not its shortcut link here with `?command=<id>`. Landing on
  // an unmarked list leaves the user to find the row themselves, which is the whole problem.
  it('marks the row named by the command search param', () => {
    shortcutsMock.shortcuts = [
      makeShortcut({ command: 'app.search', label: 'Search everywhere' }),
      makeShortcut({ command: 'tab.next', label: 'Next tab' })
    ]
    routerSearch.current = { command: 'tab.next' }

    const { container } = renderShortcutSettings()

    const focused = container.querySelectorAll('[data-focused]')
    expect(focused).toHaveLength(1)
    expect(focused[0]?.textContent).toContain('Next tab')
  })

  it('marks nothing when no command is named', () => {
    shortcutsMock.shortcuts = [
      makeShortcut({ command: 'app.search', label: 'Search everywhere' }),
      makeShortcut({ command: 'tab.next', label: 'Next tab' })
    ]

    const { container } = renderShortcutSettings()

    expect(container.querySelectorAll('[data-focused]')).toHaveLength(0)
  })
})
