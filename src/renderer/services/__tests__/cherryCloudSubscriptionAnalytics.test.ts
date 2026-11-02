import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  recordSubscribeClick,
  timeSinceSubscribeClick,
  trackSubscriptionEntryView,
  trackSubscriptionEvent
} from '../cherryCloudSubscriptionAnalytics'

const request = vi.mocked(window.api.ipcApi.request)
const tracked = () =>
  request.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track').map(([, event]) => event)

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('cherryCloudSubscriptionAnalytics', () => {
  it('reports each Subscribe entry once per window, however often it is shown', () => {
    trackSubscriptionEntryView('account_panel')
    trackSubscriptionEntryView('account_panel')
    trackSubscriptionEntryView('quota_notice')

    expect(tracked()).toEqual([
      { event: 'subscription_entry_view', source: 'account_panel' },
      { event: 'subscription_entry_view', source: 'quota_notice' }
    ])
  })

  it('never throws when the event cannot be delivered', () => {
    request.mockImplementationOnce(() => {
      throw new Error('ipc unavailable')
    })

    expect(() => trackSubscriptionEvent({ event: 'subscription_manage_click' })).not.toThrow()
  })

  it('buckets the time since the last Subscribe click for activation attribution', () => {
    vi.useFakeTimers()
    expect(timeSinceSubscribeClick()).toBe('none')

    recordSubscribeClick()
    vi.advanceTimersByTime(4 * 60_000)
    expect(timeSinceSubscribeClick()).toBe('under_5m')
    vi.advanceTimersByTime(20 * 60_000)
    expect(timeSinceSubscribeClick()).toBe('under_30m')
    vi.advanceTimersByTime(3 * 60 * 60_000)
    expect(timeSinceSubscribeClick()).toBe('under_24h')
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(timeSinceSubscribeClick()).toBe('over_24h')
  })
})
