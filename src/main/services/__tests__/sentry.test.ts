import type { ErrorEvent } from '@sentry/electron/main'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { validate as isUuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { initMock, captureExceptionMock, makeElectronTransportMock, sendMock, flushMock, preferenceState } = vi.hoisted(
  () => ({
    initMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    makeElectronTransportMock: vi.fn(),
    sendMock: vi.fn(async () => ({ statusCode: 200 })),
    flushMock: vi.fn(async () => true),
    preferenceState: { ready: true }
  })
)

// `@sentry/electron/main` is externalized, so the real module cannot load under
// Vitest (it imports Electron natively). Each integration factory is stubbed with
// the SDK's own name — a rename upstream breaks the import in sentry.ts.
vi.mock('@sentry/electron/main', () => {
  const stub = (name: string) => () => ({ name })
  return {
    init: initMock,
    captureException: captureExceptionMock,
    flush: flushMock,
    makeElectronTransport: makeElectronTransportMock,
    childProcessIntegration: (options: object) => ({ name: 'ChildProcess', options }),
    onUncaughtExceptionIntegration: stub('OnUncaughtException'),
    onUnhandledRejectionIntegration: stub('OnUnhandledRejection'),
    eventFiltersIntegration: stub('EventFilters'),
    functionToStringIntegration: stub('FunctionToString'),
    linkedErrorsIntegration: stub('LinkedErrors'),
    contextLinesIntegration: stub('ContextLines'),
    electronContextIntegration: stub('ElectronContext'),
    nodeContextIntegration: stub('NodeContext'),
    gpuContextIntegration: stub('GpuContext'),
    additionalContextIntegration: stub('AdditionalContext'),
    preloadInjectionIntegration: stub('PreloadInjection'),
    normalizePathsIntegration: stub('NormalizePaths')
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return mockApplicationFactory({
    PreferenceService: {
      ...MockMainPreferenceServiceExport.preferenceService,
      get isReady() {
        return preferenceState.ready
      }
    }
  })
})

import { application } from '@application'

import { initSentry, reportStartupFailure, reportUnexpectedFailure } from '../sentry'

function unexpected(message: string, context: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    exception: { values: [{ type: 'Error', value: message, mechanism: { type: 'generic', handled: false } }] },
    ...context
  }
}

function grantConsent() {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
}

function initOptions() {
  initSentry()
  return initMock.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('__APP_EDITION__', 'global')
  makeElectronTransportMock.mockReturnValue({ send: sendMock, flush: flushMock })
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', '')
  preferenceState.ready = true
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Sentry consent gate', () => {
  it('does not initialize in development even with reporting consent', () => {
    vi.stubEnv('DEV', true)
    grantConsent()

    initSentry()

    expect(initMock).not.toHaveBeenCalled()
  })

  it('drops every outbound envelope until the user consents', async () => {
    const transport = initOptions().transport({})
    const envelope = [{}, []]

    await transport.send(envelope)
    expect(sendMock).not.toHaveBeenCalled()

    grantConsent()
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledExactlyOnceWith(envelope)

    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('treats consent under a superseded privacy policy as no consent', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', '20200101')

    expect(initOptions().beforeSend(unexpected('boom'))).toBeNull()
  })

  it('drops events raised during preboot, before any preference store exists', () => {
    grantConsent()
    const options = initOptions()
    vi.mocked(application.getExisting).mockReturnValueOnce(undefined)

    expect(options.beforeSend(unexpected('boom'))).toBeNull()
  })

  it('sanitizes consented error events', () => {
    grantConsent()

    const event = initOptions().beforeSend(unexpected('boom', { extra: { apiKey: 'real-api-key' } }))

    expect(event).not.toBeNull()
    expect(JSON.stringify(event)).not.toContain('real-api-key')
  })

  it('blocks events and envelopes while an existing preference store is not ready', async () => {
    grantConsent()
    const options = initOptions()
    const transport = options.transport({})
    const envelope = [{}, []]

    preferenceState.ready = false
    expect(options.beforeSend(unexpected('starting'))).toBeNull()
    await transport.send(envelope)
    expect(sendMock).not.toHaveBeenCalled()

    preferenceState.ready = true
    expect(options.beforeSend(unexpected('ready'))).not.toBeNull()
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledExactlyOnceWith(envelope)

    preferenceState.ready = false
    expect(options.beforeSend(unexpected('stopped'))).toBeNull()
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})

describe('Sentry instrumentation surface', () => {
  it('uses the build release and edition rather than the packaged display name', () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')

    const options = initOptions()

    expect(options.initialScope.tags).toMatchObject({ 'app.edition': 'cn', 'event.process': 'main' })
    expect(options.release).toBe(`CherryStudio@${options.initialScope.tags['app.version']}`)
  })

  it('opts out of the SDK defaults so an upgrade cannot add instrumentation silently', () => {
    const options = initOptions()

    expect(options.defaultIntegrations).toBe(false)
    expect(options.skipOpenTelemetrySetup).toBe(true)
    expect(options.tracePropagationTargets).toEqual([])
  })

  it('keeps automatic exception capture and the consent-gated renderer bridge', () => {
    const configured = initOptions().integrations.map((integration: { name: string }) => integration.name)

    expect(configured).toContain('PreloadInjection')
    expect(configured).toContain('NormalizePaths')
    expect(configured).toContain('OnUncaughtException')
    expect(configured).toContain('ChildProcess')
    expect(configured).not.toContain('Dedupe')
  })

  it('observes native process failures without memory dumps or child command arguments', () => {
    const integrations = initOptions().integrations
    const childProcess = integrations.find((integration: { name: string }) => integration.name === 'ChildProcess')
    expect(childProcess.options).toEqual({
      breadcrumbs: false,
      events: ['crashed', 'oom', 'launch-failed', 'integrity-failure'],
      captureWorkerErrors: false,
      includeChildProcessArgs: false
    })
    expect(integrations.map((integration: { name: string }) => integration.name)).not.toContain('SentryMinidump')
  })

  it('preserves the default uncaught-exception handler without a custom fatal-error callback', () => {
    expect(initOptions().onFatalError).toBeUndefined()
  })
})

describe('Sentry client identity', () => {
  it.each(['main', 'renderer'])('identifies %s errors with the existing client ID', (process) => {
    const clientId = '91f06c3a-1776-4e98-a76f-18e03e1e6f96'
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', clientId)
    grantConsent()

    const event = initOptions().beforeSend(
      unexpected('boom', {
        tags: { 'event.process': process },
        user: { id: 'stale-user-id' }
      })
    )

    expect(event.user.id).toBe(clientId)
    expect(event.tags['event.process']).toBe(process)
  })

  it('uses the same persisted client ID across events for a new installation', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')
    grantConsent()
    const options = initOptions()

    const first = options.beforeSend(unexpected('first error'))
    const second = options.beforeSend(unexpected('second error'))

    expect(isUuid(first.user.id)).toBe(true)
    expect(second.user.id).toBe(first.user.id)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(first.user.id)
  })

  it('does not generate a client ID for an event without consent', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')

    expect(initOptions().beforeSend(unexpected('boom'))).toBeNull()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe('')
  })
})

describe('explicit startup failures', () => {
  it('reports the original failure and allows a bounded send before exit', async () => {
    grantConsent()
    const error = new Error('Database unavailable')
    await reportStartupFailure(error, 'DbService')

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      level: 'fatal',
      tags: { 'failure.kind': 'startup', service: 'DbService' }
    })
    expect(flushMock).toHaveBeenCalledWith(2000)
  })

  it('does not send startup failures before consent is readable', async () => {
    grantConsent()
    preferenceState.ready = false
    await reportStartupFailure(new Error('Startup failed'))
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(flushMock).not.toHaveBeenCalled()
  })

  it('leaves the fatal exit path usable when sending fails', async () => {
    grantConsent()
    flushMock.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(reportStartupFailure(new Error('Startup failed'))).resolves.toBeUndefined()
  })
})

describe('explicit handled internal failures', () => {
  it('keeps a handled internal error eligible at the main sending boundary', () => {
    grantConsent()
    const options = initOptions()
    const error = new TypeError('Broken internal state')
    reportUnexpectedFailure(error)

    const [reported, context] = captureExceptionMock.mock.calls[0]
    expect(reported).toBe(error)
    const event = {
      ...context,
      exception: { values: [{ type: error.name, value: error.message, mechanism: { type: 'generic', handled: true } }] }
    }
    expect(options.beforeSend(event)).not.toBeNull()
    expect(options.beforeSend(event)).toBeNull()
    expect(flushMock).not.toHaveBeenCalled()
  })

  it('does not capture internal errors before consent is readable or in development', () => {
    grantConsent()
    preferenceState.ready = false
    reportUnexpectedFailure(new Error('Before consent'))
    preferenceState.ready = true
    vi.stubEnv('DEV', true)
    reportUnexpectedFailure(new Error('Development failure'))
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('does not let a reporting error replace the application failure', () => {
    grantConsent()
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('SDK failure')
    })
    expect(() => reportUnexpectedFailure(new Error('Original failure'))).not.toThrow()
  })
})
