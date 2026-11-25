import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  recordSubscribeClick,
  subscribeClickAttribution,
  trackSubscriptionEntryView,
  trackSubscriptionEvent
} from '../cherryCloudSubscriptionAnalytics'

const request = vi.mocked(window.api.ipcApi.request)
const tracked = () =>
  request.mock.calls.filter(([route]) => route === 'cherry_cloud.analytics.track').map(([, input]) => input)

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
      { payload: { event: 'subscription_entry_view', source: 'account_panel' }, scopeId: undefined },
      { payload: { event: 'subscription_entry_view', source: 'quota_notice' }, scopeId: undefined }
    ])
  })

  it('never throws when the event cannot be delivered', () => {
    request.mockImplementationOnce(() => {
      throw new Error('ipc unavailable')
    })

    expect(() => trackSubscriptionEvent({ event: 'subscription_manage_click' })).not.toThrow()
  })

  it('attributes an activation to the last Subscribe click, keeping its flow only within a day', () => {
    vi.useFakeTimers()
    expect(subscribeClickAttribution()).toEqual({ sinceClick: 'none' })

    recordSubscribeClick()
    const flowId = recordSubscribeClick()
    vi.advanceTimersByTime(4 * 60_000)
    expect(subscribeClickAttribution()).toEqual({ sinceClick: 'under_5m', flowId })
    vi.advanceTimersByTime(20 * 60_000)
    expect(subscribeClickAttribution()).toEqual({ sinceClick: 'under_30m', flowId })
    vi.advanceTimersByTime(3 * 60 * 60_000)
    expect(subscribeClickAttribution()).toEqual({ sinceClick: 'under_24h', flowId })
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(subscribeClickAttribution()).toEqual({ sinceClick: 'over_24h' })
  })
})
