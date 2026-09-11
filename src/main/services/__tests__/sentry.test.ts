import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initMock, makeElectronTransportMock, processExitMock, sendMock, flushMock } = vi.hoisted(() => ({
  initMock: vi.fn(),
  makeElectronTransportMock: vi.fn(),
  processExitMock: vi.fn(),
  sendMock: vi.fn(async () => ({ statusCode: 200 })),
  flushMock: vi.fn(async () => true)
}))

vi.mock('node:process', () => ({ default: { exit: processExitMock } }))

vi.mock('@sentry/electron/main', () => ({
  init: initMock,
  makeElectronTransport: makeElectronTransportMock
}))

import { initSentry, setSentryReportingEnabled } from '../sentry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MAIN_VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1')
  makeElectronTransportMock.mockReturnValue({ send: sendMock, flush: flushMock })
  setSentryReportingEnabled(false)
})

describe('Sentry consent gate', () => {
  it('does not initialize Sentry without a configured DSN', () => {
    vi.stubEnv('MAIN_VITE_SENTRY_DSN', '')

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

  it('does not instrument application requests or upload native process data', () => {
    initSentry()
    const options = initMock.mock.calls[0][0]
    const integrations = options.integrations([
      { name: 'ElectronNet' },
      { name: 'NodeFetch' },
      { name: 'SentryMinidump' },
      { name: 'LocalVariables' },
      { name: 'MainProcessSession' },
      { name: 'GlobalHandlers' }
    ])

    expect(integrations).toEqual([{ name: 'GlobalHandlers' }])
    expect(options.skipOpenTelemetrySetup).toBe(true)
    expect(options.tracePropagationTargets).toEqual([])
  })

  it('terminates the main process after flushing a fatal error', () => {
    initSentry()
    const options = initMock.mock.calls[0][0]

    options.onFatalError(new Error('fatal'))

    expect(processExitMock).toHaveBeenCalledExactlyOnceWith(1)
  })
})
