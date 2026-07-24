import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppearanceSettings, { confirmMenuPresentationModeChange } from '../AppearanceSettings'

const t = (key: string) => key

const i18nMock = vi.hoisted(() => ({
  language: 'zh-CN',
  resolvedLanguage: 'zh-CN'
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: i18nMock
}))

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children)

  const Button = ({ children, onPress, ...props }: any) =>
    React.createElement('button', { ...props, onClick: onPress ?? props.onClick }, children)

  const PopoverContext = React.createContext({
    open: false,
    onOpenChange: undefined as undefined | ((open: boolean) => void)
  })

  return {
    Badge: passthrough('span'),
    Button,
    CodeEditor: ({ value, ...props }: any) =>
      React.createElement('textarea', { ...props, value: value ?? '', readOnly: true }),
    Combobox: ({ options = [], popoverClassName, renderOption, value, ...props }: any) => {
      const cleanProps = { ...props }
      delete cleanProps.emptyText
      delete cleanProps.searchPlacement
      delete cleanProps.triggerStyle

      return React.createElement(
        'div',
        { 'data-popover-class-name': popoverClassName },
        React.createElement(
          'select',
          { ...cleanProps, value: value ?? '', readOnly: true },
          options.map((option: any) =>
            React.createElement('option', { key: option.value, value: option.value }, option.label)
          )
        ),
        renderOption
          ? React.createElement(
              'div',
              { 'data-testid': 'combobox-options' },
              options.map((option: any) => React.createElement('div', { key: option.value }, renderOption(option)))
            )
          : null
      )
    },
    CustomTag: passthrough('span'),
    Flex: passthrough('div'),
    InfoTooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Input: (props: any) => React.createElement('input', props),
    MenuItem: ({ active, icon, label, onClick, ...props }: any) => {
      const cleanProps = { ...props }
      delete cleanProps.labelClassName

      return React.createElement(
        'button',
        { ...cleanProps, 'aria-pressed': active, onClick, type: 'button' },
        icon,
        label
      )
    },
    MenuList: passthrough('div'),
    PageHeader: ({ title }: { title: string }) => React.createElement('h1', null, title),
    Popover: ({ children, open = false, onOpenChange }: any) =>
      React.createElement(PopoverContext.Provider, { value: { open, onOpenChange } }, children),
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    PopoverTrigger: ({ children, asChild }: any) =>
      asChild && React.isValidElement(children) ? children : React.createElement('div', null, children),
    RowFlex: passthrough('div'),
    SegmentedControl: ({ options = [], value, onValueChange }: any) =>
      React.createElement(
        'div',
        null,
        options.map((option: any) =>
          React.createElement(
            'button',
            {
              'aria-pressed': value === option.value,
              key: option.value,
              onClick: () => onValueChange?.(option.value),
              type: 'button'
            },
            option.label
          )
        )
      ),
    Switch: ({ checked, onCheckedChange, ...props }: any) =>
      React.createElement('input', {
        ...props,
        checked: Boolean(checked),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(event.target.checked),
        type: 'checkbox'
      }),
    Tooltip: ({ children, className, classNames, content, title }: any) =>
      React.createElement(
        'div',
        {
          className: [className, classNames?.placeholder].filter(Boolean).join(' ') || undefined,
          ...(content || title ? { 'data-title': content || title } : {})
        },
        children
      )
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    settedTheme: 'light',
    setTheme: vi.fn(),
    theme: 'light'
  })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    activeCmTheme: 'light'
  })
}))

vi.mock('@renderer/hooks/useUserTheme', () => ({
  default: () => ({
    setUserTheme: vi.fn(),
    userTheme: { colorPrimary: '#1677ff', userCodeFontFamily: '', userFontFamily: '' }
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/settings/ChatPreferenceSections', () => ({
  default: () => <div data-testid="chat-preference-sections" />
}))

vi.mock('@renderer/components/SettingsPrimitives', async () => {
  const React = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children)

  return {
    SettingDescription: passthrough('p'),
    SettingDivider: passthrough('hr'),
    SettingGroup: passthrough('section'),
    SettingRow: passthrough('div'),
    SettingRowTitle: passthrough('div'),
    SettingsContentBody: passthrough('main'),
    SettingsContentColumn: passthrough('main'),
    SettingTitle: passthrough('h2')
  }
})

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/icons/ResetIcon', () => ({
  default: (props: any) => <span data-testid="reset-icon" {...props} />
}))

vi.mock('../components/ThemeColorPicker', () => ({
  default: ({ ariaLabel, value }: { ariaLabel?: string; value?: string }) => (
    <button aria-label={ariaLabel} type="button">
      {value ?? 'theme-color'}
    </button>
  )
}))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

describe('AppearanceSettings menu presentation mode', () => {
  const setMenuPresentationMode = vi.fn<(mode: MenuPresentationMode) => Promise<void>>()
  const setTimeoutTimer = vi.fn<(key: string, callback: () => void, delay: number) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    setMenuPresentationMode.mockResolvedValue(undefined)
    // Confirm resolves true so the confirmed branch runs; a test that needs the decline
    // path overrides with mockResolvedValueOnce(false).
    vi.mocked(popup.confirm).mockImplementation(async () => true)
  })

  it('does nothing when the selected mode is already active', () => {
    void confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'cherry',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(popup.confirm).not.toHaveBeenCalled()
  })

  it('saves the selected mode and schedules relaunch after confirmation', async () => {
    await confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'native',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.general.common.menu.presentation_mode.restart.title',
        content: 'settings.general.common.menu.presentation_mode.restart.content',
        okText: 'common.confirm',
        cancelText: 'common.cancel',
        centered: true
      })
    )

    expect(setMenuPresentationMode).toHaveBeenCalledWith('native')
    expect(setTimeoutTimer).toHaveBeenCalledWith('handleMenuPresentationModeChange', expect.any(Function), 500)

    setTimeoutTimer.mock.calls[0][1]()
    expect(window.api.application.relaunch).toHaveBeenCalled()
  })

  it('surfaces save failures without scheduling relaunch', async () => {
    const error = new Error('save failed')
    setMenuPresentationMode.mockRejectedValue(error)

    await expect(
      confirmMenuPresentationModeChange({
        currentMode: 'cherry',
        mode: 'native',
        setMenuPresentationMode,
        setTimeoutTimer,
        t
      })
    ).rejects.toThrow('save failed')

    expect(toast.error).toHaveBeenCalledWith('save failed')
    expect(setTimeoutTimer).not.toHaveBeenCalled()
    expect(window.api.application.relaunch).not.toHaveBeenCalled()
  })
})

describe('AppearanceSettings selectors', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    i18nMock.language = 'zh-CN'
    i18nMock.resolvedLanguage = 'zh-CN'
    mocks.request.mockReset()
    mocks.request.mockImplementation((route: string) => {
      if (route === 'system.get_fonts') return Promise.resolve([])
      if (route === 'app.adjust_zoom') return Promise.resolve(1)
      return Promise.resolve(undefined)
    })
  })

  it('shows the resolved i18n language when no app language preference is saved', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.language', null)

    render(<AppearanceSettings />)

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('system.get_fonts')
      expect(mocks.request).toHaveBeenCalledWith('app.adjust_zoom', { delta: 0 })
    })

    expect(screen.getByRole('combobox', { name: /中文/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /English/ })).not.toBeInTheDocument()
  })

  it('does not render manual chat layout switches', async () => {
    render(<AppearanceSettings />)

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('system.get_fonts')
      expect(mocks.request).toHaveBeenCalledWith('app.adjust_zoom', { delta: 0 })
    })

    expect(screen.queryByText('settings.messages.layout.conversation')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.messages.layout.work')).not.toBeInTheDocument()
  })

  it('matches both font popover widths to their triggers', async () => {
    const { container } = render(<AppearanceSettings />)

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('system.get_fonts')
    })

    const fontPopoverClassNames = Array.from(container.querySelectorAll('[data-popover-class-name]')).map((element) =>
      element.getAttribute('data-popover-class-name')
    )

    expect(fontPopoverClassNames).toHaveLength(2)
    expect(fontPopoverClassNames).toEqual([
      expect.stringContaining('w-(--radix-popover-trigger-width)'),
      expect.stringContaining('w-(--radix-popover-trigger-width)')
    ])
  })
})
