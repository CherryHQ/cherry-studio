import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GeneralSettings from '../GeneralSettings'

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
})
