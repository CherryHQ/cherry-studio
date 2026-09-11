import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }))

vi.mock('@sentry/electron/renderer', () => ({ init: initMock }))

import { initSentry } from '../sentry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEV', false)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('renderer Sentry initialization', () => {
  it('does not install renderer capture in development', () => {
    vi.stubEnv('DEV', true)

    initSentry()

    expect(initMock).not.toHaveBeenCalled()
  })

  it('forwards sanitized renderer errors through the consent-gated main process transport', () => {
    initSentry()

    expect(initMock).toHaveBeenCalledTimes(1)
    const options = initMock.mock.calls[0][0]
    expect(options).toMatchObject({
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false
    })

    const event = options.beforeSend({
      message: 'request failed: Authorization: Bearer real-token',
      extra: { apiKey: 'real-api-key' },
      request: { url: 'https://example.com/callback?code=oauth-secret' }
    })

    expect(JSON.stringify(event)).not.toContain('real-token')
    expect(JSON.stringify(event)).not.toContain('real-api-key')
    expect(JSON.stringify(event)).not.toContain('oauth-secret')
  })
})
