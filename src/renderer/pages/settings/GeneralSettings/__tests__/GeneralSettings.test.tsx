import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import GeneralSettings from '../GeneralSettings'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { address?: string }) => {
      const translations: Record<string, string> = {
        'settings.developer.cdp.title': 'Local automation (CDP)',
        'settings.developer.cdp.description': `Local tools can connect at ${options?.address}. Requires a restart.`,
        'settings.developer.cdp.restart': 'Restart to apply',
        'settings.developer.cdp.port': 'CDP port'
      }
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

vi.mock('@renderer/components/Selector', () => ({
  default: () => null
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

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
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
  InputNumber: ({
    onBlur,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onBlur'> & { onBlur?: (value: number | null) => void }) => (
    <input
      {...props}
      readOnly
      onBlur={(event) => onBlur?.(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))}
    />
  ),
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
}))

describe('GeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'BootConfig.app.remote_debugging.enabled': false,
      'BootConfig.app.remote_debugging.port': 9222,
      'app.tray.enabled': true,
      'app.tray.on_close': true,
      'app.tray.on_launch': true,
      'feature.quick_assistant.click_tray_to_show': true
    })
  })

  it('persists local automation without restarting until the user chooses to restart', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)
    const toggle = screen.getByRole('switch', { name: 'Local automation (CDP)' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/127\.0\.0\.1:9222/)).toBeInTheDocument()
    await user.click(toggle)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(true)
    )
    expect(window.api.application.relaunch).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Restart to apply' }))
    expect(window.api.application.relaunch).toHaveBeenCalledTimes(1)
  })

  it('can persist disabling local automation for the next launch', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({ 'BootConfig.app.remote_debugging.enabled': true })
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.enabled']).toBe(false)
    )
    expect(await screen.findByRole('button', { name: 'Restart to apply' })).toBeInTheDocument()
    expect(window.api.application.relaunch).not.toHaveBeenCalled()
  })

  it('keeps the port disabled until CDP is enabled and saves a custom port on blur', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)
    expect(screen.getByLabelText('CDP port')).toBeDisabled()
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    const port = await screen.findByLabelText('CDP port')
    await waitFor(() => expect(port).toBeEnabled())
    fireEvent.blur(port, { target: { value: '9342' } })
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getAllPreferenceValues()['BootConfig.app.remote_debugging.port']).toBe(9342)
    )
    expect(screen.getByRole('button', { name: 'Restart to apply' })).toBeInTheDocument()
  })

  it('reports a failed restart without losing the retry action', async () => {
    const user = userEvent.setup()
    render(<GeneralSettings />)
    await user.click(screen.getByRole('switch', { name: 'Local automation (CDP)' }))
    const restart = await screen.findByRole('button', { name: 'Restart to apply' })
    vi.mocked(window.api.application.relaunch).mockRejectedValueOnce(new Error('Cannot save startup settings'))
    await user.click(restart)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot save startup settings'))
    expect(screen.getByRole('button', { name: 'Restart to apply' })).toBeEnabled()
  })

  it('places context management directly after proxy settings', () => {
    render(<GeneralSettings />)

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'settings.launch.title',
      'settings.proxy.mode.title',
      'settings.models.context_management.title',
      'settings.agent.language.title',
      'settings.developer.title'
    ])
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

    fireEvent.click(screen.getByLabelText('settings.models.retry.label'))

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
})
