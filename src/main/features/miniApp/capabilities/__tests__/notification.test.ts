import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

const sendNotification = vi.fn()

/**
 * `NotificationService` is a LIFECYCLE service (`@Injectable`, registered in
 * `serviceRegistry`), so it is reached through the container — never constructed here.
 * `mockMiniAppApplication` because the unified factory throws on any name outside its
 * nine infrastructure services.
 */
vi.mock('@application', () =>
  mockMiniAppApplication({
    NotificationService: { sendNotification },
    MiniAppRuntimeService: { displayNameOf: () => 'My Game' }
  })
)

const { notificationCapability, resetNotificationRateForTest } = await import('../notification')
const { QuotaExceededError } = await import('../quota')

const A = 'com.example.a'

beforeEach(() => {
  sendNotification.mockReset()
  resetNotificationRateForTest()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.notification.mini_app.enabled', true)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('cherry.notification.show', () => {
  it('prefixes the title with the calling app so it cannot pose as Cherry', async () => {
    await notificationCapability.show(A, { title: 'Saved', body: 'Level 3' })
    const sent = sendNotification.mock.calls[0][0]
    expect(sent.title).toContain('My Game')
    expect(sent.title).toContain('Saved')
    expect(sent.title).not.toBe('Saved')
    expect(sent.message).toBe('Level 3')
  })

  it('declares its own source, so the user can silence mini apps alone', async () => {
    // Borrowing 'assistant' would put mini apps behind the conversation-completion
    // switch — silencing one would silence the other.
    await notificationCapability.show(A, { title: 'Saved', body: 'Level 3' })

    expect(sendNotification.mock.calls[0][0].source).toBe('mini-app')
  })

  it('sends nothing when the user has turned the category off', async () => {
    // The gate lives HERE, mirroring `deliverConversationNotification`: main-side
    // `sendNotification` shows unconditionally, so an ungated caller ignores the switch.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.notification.mini_app.enabled', false)

    await expect(notificationCapability.show(A, { title: 'Saved' })).resolves.toEqual({ ok: true })
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('carries the appId, so a renamed app cannot pose as another one', async () => {
    // The bug this guards: attributing by manifest `name`. An app holding the
    // notification grant can rename itself to "Cherry Studio" in a routine update.
    await notificationCapability.show(A, { title: 'Sign in again', body: 'Session expired' })

    expect(sendNotification.mock.calls[0][0].title).toContain(A)
  })

  it('ignores any source the app tries to supply', async () => {
    await notificationCapability.show(A, { title: 'x', body: 'y', sourceAppId: 'com.cherry.system' })
    expect(JSON.stringify(sendNotification.mock.calls[0][0])).not.toContain('com.cherry.system')
  })

  it('rejects an over-long title', async () => {
    await expect(notificationCapability.show(A, { title: 'x'.repeat(500), body: 'y' })).rejects.toThrow()
  })

  it('rate limits bursts', async () => {
    for (let i = 0; i < 5; i++) await notificationCapability.show(A, { title: 't', body: 'b' })
    await expect(notificationCapability.show(A, { title: 't', body: 'b' })).rejects.toThrow(QuotaExceededError)
  })

  it('counts a suppressed notification against the rate limit too', async () => {
    // Otherwise the switch becomes a way to reset the budget: turn it off, burn the
    // window for free, turn it on.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.notification.mini_app.enabled', false)
    for (let i = 0; i < 5; i++) await notificationCapability.show(A, { title: 't', body: 'b' })

    await expect(notificationCapability.show(A, { title: 't', body: 'b' })).rejects.toThrow(QuotaExceededError)
  })

  it('refills after the window', async () => {
    for (let i = 0; i < 5; i++) await notificationCapability.show(A, { title: 't', body: 'b' })
    vi.advanceTimersByTime(61_000)
    await expect(notificationCapability.show(A, { title: 't', body: 'b' })).resolves.toBeDefined()
  })
})
