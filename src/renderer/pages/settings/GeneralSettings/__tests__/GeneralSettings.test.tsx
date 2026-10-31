import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

import GeneralSettings from '../GeneralSettings'

const defaultPreferenceImplementation = mockUsePreference.getMockImplementation()!
const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { address?: string; route?: string }) => {
      const translations: Record<string, string> = {
        'settings.developer.cdp.title': 'Local automation (CDP)',
        'settings.developer.cdp.description': `Local tools can connect at ${options?.address}. Requires a restart.`,
        'settings.developer.cdp.port': 'CDP port',
        'settings.developer.cdp.invalid_port': 'Enter a whole-number port from 1 to 65534.',
        'settings.developer.enable_developer_mode': 'Developer mode'
      }
      if (key === 'settings.proxy.test.success' && options?.route === 'settings.proxy.test.route.fallback')
        return key + ': ' + options.route
      return translations[key] ?? key
    }
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/components/Selector', () => ({
  default: ({
    value,
    onChange,
    options
  }: {
    value: string | null
    onChange: (value: 'system' | 'custom' | 'none') => void
    options: Array<{ value: 'system' | 'custom' | 'none'; label: string }>
  }) => (
    <select
      aria-label="settings.proxy.mode.title"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value as 'system' | 'custom' | 'none')}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

vi.mock('../ContextManagementSettings', () => ({
  ContextManagementSettings: () => (
    <section>
      <h2>settings.models.context_management.title</h2>
    </section>
  )
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SettingGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingRow: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="setting-row" {...props}>
      {children}
    </div>
  ),
  SettingRowTitle: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SettingsContentColumn: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@renderer/services/popup', () => ({
  popup: { confirm: vi.fn() }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const { InputNumber } = await importOriginal<typeof CherryStudioUi>()
  return {
    Button: ({ children, loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
      <button type="button" data-loading={loading || undefined} {...props}>
        {children}
      </button>
    ),
    Flex: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    InfoTooltip: () => null,
    Combobox: ({
      options,
      value,
      onChange,
      'aria-label': ariaLabel
    }: {
      options: { value: string; label: string }[]
      value?: string | string[]
      onChange?: (value: string | string[]) => void
      'aria-label'?: string
    }) => (
      <select
        aria-label={ariaLabel}
        value={Array.isArray(value) ? (value[0] ?? '') : (value ?? '')}
        onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    InputNumber,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} {...props}>
        switch
      </button>
    )
  }
})

const requestedRoutes = () => vi.mocked(window.api.ipcApi.request).mock.calls.map(([route]) => route)

describe('GeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePreference.mockImplementation(defaultPreferenceImplementation)
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'BootConfig.app.remote_debugging.enabled': false,
      'BootConfig.app.remote_debugging.port': 9222,
      'app.developer_mode.enabled': false,
      'app.tray.enabled': true,
      'app.tray.on_close': true,
      'app.tray.on_launch': true,
      'feature.quick_assistant.click_tray_to_show': true
    })
    ipcRequestMock.mockReset()
    ipcRequestMock.mockResolvedValue({
      target: 'https://www.gstatic.com/generate_204',
      route: 'proxy',
      success: true
    })
  })

  it('describes successful PAC fallback as automatic routing rather than certified proxy use', async () => {
    ipcRequestMock.mockResolvedValue({
      target: 'https://www.gstatic.com/generate_204',
      route: 'fallback',
      success: true
    })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('button', { name: 'settings.proxy.test.action' }))
    expect(
      await screen.findByText('settings.proxy.test.success: settings.proxy.test.route.fallback')
    ).toBeInTheDocument()
  })

  it('only exposes local automation after developer mode is enabled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<GeneralSettings />)
    expect(screen.queryByRole('switch', { name: 'Local automation (CDP)' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CDP port')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(true))
    rerender(<GeneralSettings />)
    expect(screen.getByRole('switch', { name: 'Local automation (CDP)' })).toBeInTheDocument()
    expect(screen.getByLabelText('CDP port')).toBeInTheDocument()
  })

  it.each(['0', '-1', '65535', '9222.9', ''])(
    'rejects invalid port %j without changing the saved endpoint',
    async (value) => {
      MockUsePreferenceUtils.setMultiplePreferenceValues({
        'app.developer_mode.enabled': true,
        'BootConfig.app.remote_debugging.enabled': true,
        'BootConfig.app.remote_debugging.port': 9342
      })
      const user = userEvent.setup()
      render(<GeneralSettings />)
      const port = screen.getByRole('spinbutton', { name: 'CDP port' })

      await user.clear(port)
      if (value) await user.type(port, value)
      await user.tab()

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter a whole-number port from 1 to 65534.'))
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.port']).toBe(9342)
      expect(port).toHaveValue('9342')
    }
  )

  it.each(['1', '9342', '65534'])('saves supported port %s without changing its value', async (value) => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'BootConfig.app.remote_debugging.enabled': true
    })
    const user = userEvent.setup()
    const { rerender } = render(<GeneralSettings />)
    const port = screen.getByRole('spinbutton', { name: 'CDP port' })

    await user.clear(port)
    await user.type(port, value)
    await user.tab()

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.port']).toBe(
        Number(value)
      )
    )
    rerender(<GeneralSettings />)
    expect(port).toHaveValue(value)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('saves local automation without providing or triggering an automatic restart', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'app.developer_mode.enabled': true })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    const toggle = screen.getByRole('switch', { name: 'Local automation (CDP)' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/127\.0\.0\.1:9222/)).toBeInTheDocument()
    await user.click(toggle)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(true)
    )
    expect(requestedRoutes()).not.toContain('app.relaunch')
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument()
  })

  it('can persist disabling local automation for the next launch', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'BootConfig.app.remote_debugging.enabled': true
    })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
    )
    expect(requestedRoutes()).not.toContain('app.relaunch')
  })

  it('keeps the port disabled until CDP is enabled and saves a custom port on blur', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'app.developer_mode.enabled': true })
    const user = userEvent.setup()
    const { rerender } = render(<GeneralSettings />)
    expect(screen.getByLabelText('CDP port')).toBeDisabled()
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(true)
    )
    rerender(<GeneralSettings />)
    const port = screen.getByLabelText('CDP port')
    expect(port).toBeEnabled()
    await user.clear(port)
    await user.type(port, '9342')
    await user.tab()
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.port']).toBe(9342)
    )
    rerender(<GeneralSettings />)
    expect(screen.getByText(/127\.0\.0\.1:9342/)).toBeInTheDocument()
  })

  it('disables local automation when developer mode is switched off', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'BootConfig.app.remote_debugging.enabled': true
    })
    const user = userEvent.setup()
    const { rerender } = render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
      expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(false)
    })
    rerender(<GeneralSettings />)
    expect(screen.queryByRole('switch', { name: 'Local automation (CDP)' })).not.toBeInTheDocument()
    expect(requestedRoutes()).not.toContain('app.relaunch')
  })

  it('prevents a pending CDP enable from racing with disabling developer mode', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'app.developer_mode.enabled': true })
    let finishSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    mockUsePreference.mockImplementation((key, options) => {
      const [value, save] = defaultPreferenceImplementation(key, options)
      return [
        value,
        async (next) => {
          if (String(key) === 'BootConfig.app.remote_debugging.enabled') await pendingSave
          await save(next)
        }
      ]
    })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    expect(screen.getByRole('switch', { name: 'Developer mode' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Local automation (CDP)' })).toBeDisabled()
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    finishSave()
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(true)
      expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(true)
      expect(screen.getByRole('switch', { name: 'Developer mode' })).toBeEnabled()
    })
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
      expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(false)
    })
  })

  it('blocks a new CDP enable while developer mode is being disabled', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'BootConfig.app.remote_debugging.enabled': true
    })
    let finishSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    mockUsePreference.mockImplementation((key, options) => {
      const [value, save] = defaultPreferenceImplementation(key, options)
      return [
        value,
        async (next) => {
          if (key === 'app.developer_mode.enabled') await pendingSave
          await save(next)
        }
      ]
    })
    const user = userEvent.setup()
    const { rerender } = render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
    )
    rerender(<GeneralSettings />)
    const cdp = screen.getByRole('switch', { name: 'Local automation (CDP)' })
    expect(cdp).toBeDisabled()
    expect(screen.getByLabelText('CDP port')).toBeDisabled()
    await user.click(cdp)
    finishSave()
    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(false)
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
      expect(screen.queryByRole('switch', { name: 'Local automation (CDP)' })).not.toBeInTheDocument()
    })
  })

  it('keeps developer mode enabled and unlocks the controls when disabling CDP fails', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'BootConfig.app.remote_debugging.enabled': true
    })
    mockUsePreference.mockImplementation((key, options) => {
      const [value, save] = defaultPreferenceImplementation(key, options)
      return [
        value,
        String(key) === 'BootConfig.app.remote_debugging.enabled'
          ? async () => {
              throw new Error('Cannot save CDP setting')
            }
          : save
      ]
    })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Developer mode' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot save CDP setting'))
    expect(MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')).toBe(true)
    expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(true)
    expect(screen.getByRole('switch', { name: 'Developer mode' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Local automation (CDP)' })).toBeEnabled()
  })

  it('renders model retry settings in General and persists changes', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.retry.enabled': true,
      'chat.retry.max_attempts': 3,
      'chat.retry.backoff_enabled': true,
      'chat.retry.fallback_model_ids': ['openai::gpt-4o']
    })

    render(<GeneralSettings />)

    expect(screen.getByLabelText('settings.models.retry.max_attempts')).toHaveValue('3')
    expect(screen.getByLabelText('settings.models.retry.backoff')).toBeInTheDocument()
    expect(screen.getByText('settings.models.retry.fallback_models_count')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('settings.general.retry.enabled'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.retry.enabled')).toBe(false)
    })
  })

  it('turns off every tray-dependent preference when the tray is disabled', async () => {
    render(<GeneralSettings />)

    const trayRow = screen.getByText('settings.tray.show').closest<HTMLElement>('[data-testid="setting-row"]')
    expect(trayRow).not.toBeNull()
    fireEvent.click(within(trayRow!).getByRole('switch'))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.tray.enabled')).toBe(false)
      expect(MockUsePreferenceUtils.getPreferenceValue('app.tray.on_close')).toBe(false)
      expect(MockUsePreferenceUtils.getPreferenceValue('app.tray.on_launch')).toBe(false)
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.click_tray_to_show')).toBe(false)
    })
  })

  it('renders the agent reply language row defaulting to follow conversation', () => {
    render(<GeneralSettings />)

    const preset = screen.getByRole('combobox', { name: 'settings.agent.language.combo_label' })
    expect(preset).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'settings.agent.language.custom_label' })).toHaveValue('')
    expect(screen.queryByText('settings.agent.language.description')).not.toBeInTheDocument()
  })

  it('persists the agent reply language preset', async () => {
    render(<GeneralSettings />)

    fireEvent.change(screen.getByRole('combobox', { name: 'settings.agent.language.combo_label' }), {
      target: { value: '日本語' }
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('agent.language')).toBe('日本語')
    })
  })

  it('tests the edited proxy values without persisting them first', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.proxy.mode': 'custom',
      'app.proxy.url': 'http://saved.example:8080',
      'app.proxy.bypass_rules': 'localhost'
    })
    render(<GeneralSettings />)

    const proxyUrlInput = screen.getByDisplayValue('http://saved.example:8080')
    const bypassRulesInput = screen.getByDisplayValue('localhost')
    const testButton = screen.getByRole('button', { name: 'settings.proxy.test.action' })

    await user.clear(proxyUrlInput)
    await user.type(proxyUrlInput, 'socks5://edited.example:1080')
    await user.click(testButton)

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('proxy.test_connection', {
        mode: 'custom',
        url: 'socks5://edited.example:1080',
        bypassRules: 'localhost'
      })
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.proxy.url')).toBe('http://saved.example:8080')

    await user.clear(bypassRulesInput)
    await user.type(bypassRulesInput, 'www.gstatic.com')
    await user.click(testButton)

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenLastCalledWith('proxy.test_connection', {
        mode: 'custom',
        url: 'socks5://edited.example:1080',
        bypassRules: 'www.gstatic.com'
      })
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.proxy.bypass_rules')).toBe('localhost')
  })

  it('persists edited bypass rules when tabbing to the next setting without testing', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.proxy.mode': 'custom',
      'app.proxy.url': 'http://saved.example:8080',
      'app.proxy.bypass_rules': 'localhost'
    })
    render(<GeneralSettings />)

    const bypassRulesInput = screen.getByDisplayValue('localhost')

    await user.clear(bypassRulesInput)
    await user.type(bypassRulesInput, 'www.gstatic.com')
    await user.tab()

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('app.proxy.bypass_rules')).toBe('www.gstatic.com')
    })
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  it('ignores a deferred result after the proxy input changes and clears results when the mode changes', async () => {
    let resolveRequest: (result: { target: string; route: 'proxy'; success: true }) => void = () => undefined
    const deferredRequest = new Promise<{ target: string; route: 'proxy'; success: true }>((resolve) => {
      resolveRequest = resolve
    })
    ipcRequestMock.mockReturnValueOnce(deferredRequest)
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.proxy.mode': 'custom',
      'app.proxy.url': 'http://old.example:8080',
      'app.proxy.bypass_rules': 'localhost'
    })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.proxy.test.action' }))
    fireEvent.change(screen.getByDisplayValue('http://old.example:8080'), {
      target: { value: 'http://new.example:8080' }
    })
    resolveRequest({ target: 'https://www.gstatic.com/generate_204', route: 'proxy', success: true })

    await waitFor(() => expect(screen.queryByText('settings.proxy.test.success')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'settings.proxy.test.action' }))
    await waitFor(() => expect(screen.getByText('settings.proxy.test.success')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('settings.proxy.mode.title'), { target: { value: 'none' } })
    expect(screen.queryByText('settings.proxy.test.success')).not.toBeInTheDocument()
  })
})
