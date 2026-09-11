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

  it('sanitizes events and attaches the running build and window context', () => {
    initSentry()

    const options = initMock.mock.calls[0][0]
    expect(options).toMatchObject({
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false
    })

    const event = options.beforeSend({
      extra: { apiKey: 'real-api-key' }
    })

    expect(JSON.stringify(event)).not.toContain('real-api-key')
    expect(event.tags).toMatchObject({ window: 'QuickAssistant', 'app.edition': 'global', 'event.process': 'renderer' })
    expect(options.release).toBe(`CherryStudio@${event.tags['app.version']}`)
  })

  it('captures handled render errors in their originating process with safe context', () => {
    initSentry()
    const cause = new Error('Storage unavailable')
    const error = new AggregateError([cause], 'Render failed', { cause })
    loggerService
      .withContext('ErrorBoundary', { prompt: 'private conversation' })
      .error('Caught a render error', error, {
        operation: 'react.render',
        componentStack: 'at MessageList',
        apiKey: 'private-key'
      })
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toBe(error)
    expect(reported.cause).toBe(cause)
    expect(reported.errors).toEqual([cause])
    expect(context.tags).toMatchObject({
      module: 'ErrorBoundary',
      operation: 'react.render',
      'event.process': 'renderer'
    })
    expect(context.extra).toEqual({ componentStack: 'at MessageList' })
    expect(JSON.stringify(context)).not.toContain('private')
  })
})
