import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GeneralSettings from '../GeneralSettings'

const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
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
  Button: ({ children, loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button type="button" data-loading={loading || undefined} {...props}>
      {children}
    </button>
  ),
  Flex: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  InfoTooltip: () => null,
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
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
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

  it('places context management directly after proxy settings', () => {
    render(<GeneralSettings />)

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'settings.launch.title',
      'settings.proxy.mode.title',
      'settings.models.context_management.title',
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

  it('tests the edited proxy values without persisting them first', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.proxy.mode': 'custom',
      'app.proxy.url': 'http://saved.example:8080',
      'app.proxy.bypass_rules': 'localhost'
    })
    render(<GeneralSettings />)

    fireEvent.change(screen.getByDisplayValue('http://saved.example:8080'), {
      target: { value: 'socks5://edited.example:1080' }
    })
    fireEvent.change(screen.getByDisplayValue('localhost'), { target: { value: 'www.gstatic.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.proxy.test.action' }))

    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('proxy.test_connection', {
        mode: 'custom',
        url: 'socks5://edited.example:1080',
        bypassRules: 'www.gstatic.com'
      })
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('app.proxy.url')).toBe('http://saved.example:8080')
    expect(MockUsePreferenceUtils.getPreferenceValue('app.proxy.bypass_rules')).toBe('localhost')
  })
})
