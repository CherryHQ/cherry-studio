import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  dedupeIntegration: () => ({ name: 'Dedupe' }),
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

  it('gates and sanitizes error events as consent changes', () => {
    initSentry()
    const { beforeSend } = initMock.mock.calls[0][0]
    const event = { extra: { apiKey: 'real-api-key' } }
    expect(beforeSend(event)).toBeNull()
    setSentryReportingEnabled(true)
    expect(beforeSend(event).extra.apiKey).not.toBe('real-api-key')
    setSentryReportingEnabled(false)
    expect(beforeSend(event)).toBeNull()
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

  it('terminates the main process when the SDK invokes its fatal-error callback', () => {
    initSentry()
    const options = initMock.mock.calls[0][0]

    options.onFatalError(new Error('fatal'))

    expect(processExitMock).toHaveBeenCalledExactlyOnceWith(1)
  })
})
