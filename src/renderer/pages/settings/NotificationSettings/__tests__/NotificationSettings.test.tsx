import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NotificationSettings from '../NotificationSettings'

const platform = vi.hoisted(() => ({ isMac: true }))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const enabledSwitch = () => screen.getByRole('switch', { name: 'settings.notification.conversation_island.enabled' })

describe('NotificationSettings Conversation Island preferences', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_island.enabled', false)
    platform.isMac = true
  })

  it('persists the macOS-only switch without revealing another option', async () => {
    const user = userEvent.setup()
    const view = render(<NotificationSettings />)

    expect(enabledSwitch()).not.toBeChecked()
    expect(screen.getAllByRole('switch')).toHaveLength(5)

    await user.click(enabledSwitch())
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.conversation_island.enabled')).toBe(true)
    )
    view.rerender(<NotificationSettings />)

    expect(enabledSwitch()).toBeChecked()
    expect(screen.getAllByRole('switch')).toHaveLength(5)
  })

  it('does not expose Conversation Island settings off macOS', () => {
    platform.isMac = false
    render(<NotificationSettings />)

    expect(screen.queryByRole('switch', { name: 'settings.notification.conversation_island.enabled' })).toBeNull()
    expect(screen.getAllByRole('switch')).toHaveLength(4)
    expect(MockUsePreference.usePreference).not.toHaveBeenCalledWith('feature.conversation_island.enabled')
  })
})
