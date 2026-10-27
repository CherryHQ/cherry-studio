import type * as SentryRenderer from '@sentry/electron/renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChannel } from '@shared/IpcChannel'

const { initMock, captureExceptionMock } = vi.hoisted(() => ({ initMock: vi.fn(), captureExceptionMock: vi.fn() }))

vi.mock('@sentry/electron/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryRenderer>()),
  init: initMock,
  captureException: captureExceptionMock
}))
vi.unmock('@logger')

import { loggerService } from '../LoggerService'
import { initSentry, reportRenderFailure } from '../sentry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEV', false)
  document.head.innerHTML = '<meta name="logger-window-source" content="QuickAssistant" />'
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('renderer Sentry initialization', () => {
  it('opts into error capture and IPC bridging without enabling ambient data collection', () => {
    initSentry()

    const options = initMock.mock.calls[0][0]
    expect(options.defaultIntegrations).toBe(false)
    expect(options.integrations.map((integration: { name: string }) => integration.name).sort()).toEqual(
      ['EventFilters', 'FunctionToString', 'BrowserApiErrors', 'GlobalHandlers', 'LinkedErrors', 'ScopeToMain'].sort()
    )
  })

  it('does not install renderer capture in development', () => {
    vi.stubEnv('DEV', true)

    initSentry()

    expect(initMock).not.toHaveBeenCalled()
  })

  it('sanitizes events and attaches the running build and window context', () => {
    initSentry()

    const options = initMock.mock.calls[0][0]
    // No DSN here on purpose: events ride IPC to the main process, where the
    // consent gate lives. A DSN would let the renderer report around it.
    expect(options.dsn).toBeUndefined()

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
    reportRenderFailure(error, 'at MessageList')
    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toBe(error)
    expect(reported.cause).toBe(cause)
    expect(reported.errors).toEqual([cause])
    expect(context.tags).toEqual({ 'failure.kind': 'render' })
    expect(context.extra).toEqual({ componentStack: 'at MessageList' })
    expect(JSON.stringify(context)).not.toContain('private')
  })

  it('keeps ordinary error logs local after Sentry initialization', () => {
    initSentry()
    loggerService.withContext('DataApiService').error('Request failed', new Error('Topic not found'))
    loggerService.withContext('AnalyticsService').error('Upload failed', new Error('fetch failed'))

    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannel.App_LogToMain,
      expect.objectContaining({ module: 'DataApiService' }),
      'error',
      'Request failed',
      [expect.objectContaining({ errorMessage: 'Topic not found' })]
    )
  })

  it('does not explicitly report render failures in development', () => {
    vi.stubEnv('DEV', true)
    reportRenderFailure(new Error('Render failed'))
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})
