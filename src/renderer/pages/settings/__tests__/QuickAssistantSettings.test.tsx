import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantSettings from '../QuickAssistantSettings'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Divider: () => React.createElement('hr'),
    InfoTooltip: ({ content }: { content: string }) =>
      React.createElement('button', { 'aria-label': content, type: 'button' }),
    Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) =>
      React.createElement('button', {
        'aria-checked': checked,
        onClick: () => onCheckedChange(!checked),
        role: 'switch',
        type: 'button'
      })
  }
})

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { info: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('QuickAssistantSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.click_tray_to_show', false)
    requestMock.mockReset()
  })

  it('keeps assistant and model selection in the composer instead of duplicating it in settings', () => {
    render(<QuickAssistantSettings />)

    expect(screen.getByText('settings.quickAssistant.title')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.quick_assistant_response_settings')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.models.quick_assistant_usage_method')).not.toBeInTheDocument()
  })

  it('still closes the quick assistant when the feature is disabled', async () => {
    const user = userEvent.setup()
    render(<QuickAssistantSettings />)

    await user.click(screen.getAllByRole('switch')[0])

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.enabled')).toBe(false)
      expect(requestMock).toHaveBeenCalledWith('quick_assistant.close')
    })
  })
})
