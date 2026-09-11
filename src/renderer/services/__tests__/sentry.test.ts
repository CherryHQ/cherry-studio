import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { initMock, captureExceptionMock } = vi.hoisted(() => ({ initMock: vi.fn(), captureExceptionMock: vi.fn() }))

vi.mock('@sentry/electron/renderer', () => ({ init: initMock, captureException: captureExceptionMock }))
vi.unmock('@logger')

import { loggerService } from '../LoggerService'
import { initSentry } from '../sentry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEV', false)
  document.head.innerHTML = '<meta name="logger-window-source" content="QuickAssistant" />'
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
    expect(event.tags).toMatchObject({ window: 'QuickAssistant', 'app.edition': 'global', 'event.process': 'renderer' })
    expect(options.release).toBe(`CherryStudio@${event.tags['app.version']}`)
  })

  it('captures handled render errors in their originating process with safe context', () => {
    initSentry()
    const error = new TypeError('Render failed')
    loggerService
      .withContext('ErrorBoundary', { prompt: 'private conversation' })
      .error('Caught a render error', error, {
        operation: 'react.render',
        componentStack: 'at MessageList',
        apiKey: 'private-key'
      })
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toMatchObject({ name: 'TypeError', message: 'Render failed', stack: error.stack })
    expect(context.tags).toMatchObject({
      module: 'ErrorBoundary',
      operation: 'react.render',
      'event.process': 'renderer'
    })
    expect(context.extra).toEqual({ componentStack: 'at MessageList' })
    expect(JSON.stringify(context)).not.toContain('private')
  })
})
