import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationPrimingBanner } from '../NotificationPrimingBanner'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn(() => Promise.resolve()) }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))

const PREF_KEYS = [
  'app.notification.assistant.enabled',
  'app.notification.approval.enabled',
  'app.notification.scheduled_task.enabled',
  'app.notification.priming_banner.dismissed'
] as const

describe('NotificationPrimingBanner', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mocks.ipcRequest.mockClear()
    for (const key of PREF_KEYS) MockUsePreferenceUtils.setPreferenceValue(key, false)
  })

  it('shows while notifications are off and not dismissed', () => {
    render(<NotificationPrimingBanner />)
    expect(screen.getByRole('region')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('Allow enables all agent notifications, fires an OS notification and stays hidden afterwards', async () => {
    render(<NotificationPrimingBanner />)
    fireEvent.click(screen.getAllByRole('button')[0])

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.send', expect.any(Object)))
    for (const key of PREF_KEYS) expect(MockUsePreferenceUtils.getPreferenceValue(key)).toBe(true)
  })

  it('Dismiss hides the banner without enabling notifications', async () => {
    render(<NotificationPrimingBanner />)
    fireEvent.click(screen.getAllByRole('button')[1])

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.notification.priming_banner.dismissed')).toBe(true)
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.notification.assistant.enabled')).toBe(false)
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it.each(['app.notification.assistant.enabled', 'app.notification.approval.enabled'] as const)(
    'stays hidden when %s was already enabled in Settings',
    (key) => {
      MockUsePreferenceUtils.setPreferenceValue(key, true)
      const { container } = render(<NotificationPrimingBanner />)
      expect(container).toBeEmptyDOMElement()
    }
  )
})
