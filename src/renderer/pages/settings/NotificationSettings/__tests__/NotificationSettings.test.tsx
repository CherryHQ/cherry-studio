import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
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
const titleSwitch = () => screen.getByRole('switch', { name: 'settings.notification.conversation_island.show_title' })

describe('NotificationSettings Conversation Island preferences', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.conversation_island.enabled': false,
      'feature.conversation_island.show_title': true
    })
    platform.isMac = true
  })

  it('shows the macOS-only switch and reveals the title option only when enabled', async () => {
    const user = userEvent.setup()
    const view = render(<NotificationSettings />)

    expect(enabledSwitch()).not.toBeChecked()
    expect(screen.queryByRole('switch', { name: 'settings.notification.conversation_island.show_title' })).toBeNull()

    await user.click(enabledSwitch())
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.conversation_island.enabled')).toBe(true)
    )
    view.rerender(<NotificationSettings />)

    expect(titleSwitch()).toBeChecked()
  })

  it('persists the title visibility option', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_island.enabled', true)
    render(<NotificationSettings />)

    await user.click(titleSwitch())

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.conversation_island.show_title')).toBe(false)
    )
  })

  it('does not expose Conversation Island settings off macOS', () => {
    platform.isMac = false
    render(<NotificationSettings />)

    expect(screen.queryByRole('switch', { name: 'settings.notification.conversation_island.enabled' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'settings.notification.conversation_island.show_title' })).toBeNull()
  })
})
