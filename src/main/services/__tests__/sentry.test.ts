import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { initMock, makeElectronTransportMock, processExitMock, sendMock, flushMock } = vi.hoisted(() => ({
  initMock: vi.fn(),
  makeElectronTransportMock: vi.fn(),
  processExitMock: vi.fn(),
  sendMock: vi.fn(async () => ({ statusCode: 200 })),
  flushMock: vi.fn(async () => true)
}))

vi.mock('node:process', () => ({ default: { exit: processExitMock } }))

vi.mock('@sentry/electron/main', async () => ({
  init: initMock,
  dedupeIntegration: (await import('@sentry/electron/renderer')).dedupeIntegration,
  makeElectronTransport: makeElectronTransportMock
}))

import { initSentry, setSentryReportingEnabled } from '../sentry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('__APP_EDITION__', 'global')
  makeElectronTransportMock.mockReturnValue({ send: sendMock, flush: flushMock })
  setSentryReportingEnabled(false)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Sentry consent gate', () => {
  it('uses the build release and edition rather than the packaged display name', () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    initSentry()
    const options = initMock.mock.calls[0][0]
    expect(options.release).toMatch(/^CherryStudio@/)
    expect(options.initialScope.tags).toMatchObject({ 'app.edition': 'cn', 'event.process': 'main' })
    expect(options.release).toBe(`CherryStudio@${options.initialScope.tags['app.version']}`)
  })
  it('does not initialize in development even with reporting consent', () => {
    vi.stubEnv('DEV', true)
    setSentryReportingEnabled(true)

    initSentry()

    expect(initMock).not.toHaveBeenCalled()
  })

  it('drops every outbound envelope until reporting is enabled', async () => {
    initSentry()
    const options = initMock.mock.calls[0][0]
    const transport = options.transport({})
    const envelope = [{}, []]

    await transport.send(envelope)
    expect(sendMock).not.toHaveBeenCalled()

    setSentryReportingEnabled(true)
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledExactlyOnceWith(envelope)

    setSentryReportingEnabled(false)
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('redacts credentials from consented error events', () => {
    initSentry()
    setSentryReportingEnabled(true)
    const options = initMock.mock.calls[0][0]

    const event = options.beforeSend({
      message: 'request failed: Authorization: Bearer real-token',
      extra: { apiKey: 'real-api-key' },
      request: { url: 'https://example.com/callback?code=oauth-secret' }
    })

    expect(JSON.stringify(event)).not.toContain('real-token')
    expect(JSON.stringify(event)).not.toContain('real-api-key')
    expect(JSON.stringify(event)).not.toContain('oauth-secret')
  })

  it('does not instrument application requests, overwrite Chromium flags, or upload native process data', () => {
    initSentry()
    const options = initMock.mock.calls[0][0]
    const integrations = options.integrations([
      { name: 'ElectronNet' },
      { name: 'NodeFetch' },
      { name: 'SentryMinidump' },
      { name: 'LocalVariables' },
      { name: 'MainProcessSession' },
      { name: 'RendererEventLoopBlock' },
      { name: 'GlobalHandlers' }
    ])

    expect(integrations.map((integration: { name: string }) => integration.name)).toEqual(['GlobalHandlers', 'Dedupe'])
    expect(options.skipOpenTelemetrySetup).toBe(true)
    expect(options.tracePropagationTargets).toEqual([])
  })

  it('terminates the main process after flushing a fatal error', () => {
    initSentry()
    const options = initMock.mock.calls[0][0]

    options.onFatalError(new Error('fatal'))

    expect(processExitMock).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('drops repeated exceptions but keeps distinct failures', () => {
    initSentry()
    const integration = initMock.mock.calls[0][0]
      .integrations([])
      .find((item: { name: string }) => item.name === 'Dedupe')
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'disk full',
            stacktrace: {
              frames: [{ filename: 'app:///jobs.js', function: 'enqueue', lineno: 20, colno: 4 }]
            }
          }
        ]
      }
    }
    expect(integration.processEvent(event)).toEqual(event)
    expect(integration.processEvent(structuredClone(event))).toBeNull()
    const other = structuredClone(event)
    other.exception.values[0].value = 'permission denied'
    expect(integration.processEvent(other)).toEqual(other)
  })
})
