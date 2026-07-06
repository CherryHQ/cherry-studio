import type { MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import GeneralSettings, { confirmMenuPresentationModeChange } from '../index'

const i18nMock = vi.hoisted(() => ({
  language: 'zh-CN',
  resolvedLanguage: 'zh-CN'
}))

vi.mock('@renderer/i18n', () => ({
  default: i18nMock
}))

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
    Combobox: ({ options = [], value, ...props }: any) => {
      const cleanProps = { ...props }
      delete cleanProps.emptyText
      delete cleanProps.popoverClassName
      delete cleanProps.renderOption
      delete cleanProps.searchPlacement
      delete cleanProps.triggerStyle

      return React.createElement(
        'select',
        { ...cleanProps, value: value ?? '', readOnly: true },
        options.map((option: any) =>
          React.createElement('option', { key: option.value, value: option.value }, option.label)
        )
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
    Slider: ({ value }: any) =>
      React.createElement('div', {
        'data-testid': 'slider',
        'data-value': Array.isArray(value) ? value.join(',') : String(value)
      }),
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
    Tooltip: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/settings/ChatPreferenceSections', () => ({
  default: () => <div data-testid="chat-preference-sections" />
}))

vi.mock('@renderer/components/Icons', () => ({
  ResetIcon: (props: any) => <span data-testid="reset-icon" {...props} />
}))

vi.mock('@renderer/components/SettingsPrimitives', async () => {
  const React = await import('react')
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children)

  return {
    SettingDivider: passthrough('hr'),
    SettingGroup: passthrough('section'),
    SettingRow: passthrough('div'),
    SettingRowTitle: passthrough('div'),
    SettingsContentColumn: passthrough('main'),
    SettingTitle: passthrough('h2')
  }
})

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

describe('GeneralSettings menu presentation mode', () => {
  const t = (key: string) => key
  const setMenuPresentationMode = vi.fn<(mode: MenuPresentationMode) => Promise<void>>()
  const setTimeoutTimer = vi.fn<(key: string, callback: () => void, delay: number) => void>()
  const confirm = vi.fn()
  const relaunch = vi.fn()
  const toastError = vi.fn()

  let originalModal: any
  let originalToast: any
  let originalApi: any

  beforeEach(() => {
    vi.clearAllMocks()
    setMenuPresentationMode.mockResolvedValue(undefined)
    originalModal = (window as any).modal
    originalToast = (window as any).toast
    originalApi = (window as any).api
    ;(window as any).modal = { confirm }
    ;(window as any).toast = { error: toastError }
    ;(window as any).api = { application: { relaunch } }
  })

  afterEach(() => {
    ;(window as any).modal = originalModal
    ;(window as any).toast = originalToast
    ;(window as any).api = originalApi
  })

  it('does nothing when the selected mode is already active', () => {
    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'cherry',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(confirm).not.toHaveBeenCalled()
  })

  it('saves the selected mode and schedules relaunch after confirmation', async () => {
    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'native',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.general.common.menu.presentation_mode.restart.title',
        content: 'settings.general.common.menu.presentation_mode.restart.content',
        okText: 'common.confirm',
        cancelText: 'common.cancel',
        centered: true
      })
    )

    const options = confirm.mock.calls[0][0]
    await options.onOk()

    expect(setMenuPresentationMode).toHaveBeenCalledWith('native')
    expect(setTimeoutTimer).toHaveBeenCalledWith('handleMenuPresentationModeChange', expect.any(Function), 500)

    setTimeoutTimer.mock.calls[0][1]()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('surfaces save failures without scheduling relaunch', async () => {
    const error = new Error('save failed')
    setMenuPresentationMode.mockRejectedValue(error)

    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'native',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    const options = confirm.mock.calls[0][0]
    await expect(options.onOk()).rejects.toThrow('save failed')

    expect(toastError).toHaveBeenCalledWith('save failed')
    expect(setTimeoutTimer).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
  })
})

describe('GeneralSettings language selector', () => {
  let originalApi: any

  beforeEach(() => {
    originalApi = (window as any).api
    MockUsePreferenceUtils.resetMocks()
    i18nMock.language = 'zh-CN'
    i18nMock.resolvedLanguage = 'zh-CN'
    ;(window as any).api = {
      handleZoomFactor: vi.fn().mockResolvedValue(1),
      setEnableSpellCheck: vi.fn()
    }
  })

  afterEach(() => {
    ;(window as any).api = originalApi
  })

  it('shows the resolved i18n language when no app language preference is saved', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.language', null)

    render(<GeneralSettings />)

    await waitFor(() => {
      expect(window.api.handleZoomFactor).toHaveBeenCalled()
    })

    expect(screen.getByRole('combobox', { name: /中文/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /English/ })).not.toBeInTheDocument()
  })
})
