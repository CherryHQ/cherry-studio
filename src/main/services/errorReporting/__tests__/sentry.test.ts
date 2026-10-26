import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { validate as isUuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { initMock, makeElectronTransportMock, sendMock, flushMock, preferenceState } = vi.hoisted(() => ({
  initMock: vi.fn(),
  makeElectronTransportMock: vi.fn(),
  sendMock: vi.fn(async () => ({ statusCode: 200 })),
  flushMock: vi.fn(async () => true),
  preferenceState: { ready: true }
}))

// `@sentry/electron/main` is externalized, so the real module cannot load under
// Vitest (it imports Electron natively). Each integration factory is stubbed with
// the SDK's own name — a rename upstream breaks the import in sentry.ts.
vi.mock('@sentry/electron/main', () => {
  const stub = (name: string) => () => ({ name })
  return {
    init: initMock,
    makeElectronTransport: makeElectronTransportMock,
    dedupeIntegration: stub('Dedupe'),
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
import { BaseService } from '@main/core/lifecycle'

import { ErrorReportingService } from '../ErrorReportingService'
import { initSentry } from '../sentry'

let reporting: ErrorReportingService

function grantConsent() {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
}

function initOptions() {
  initSentry()
  return initMock.mock.calls[0][0]
}

beforeEach(async () => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('__APP_EDITION__', 'global')
  makeElectronTransportMock.mockReturnValue({ send: sendMock, flush: flushMock })
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', '')
  preferenceState.ready = true
  BaseService.resetInstances()
  reporting = new ErrorReportingService()
  const preferenceService = application.get('PreferenceService')
  vi.mocked(application.getExisting).mockImplementation((name) =>
    name === 'ErrorReportingService' ? reporting : name === 'PreferenceService' ? preferenceService : undefined
  )
  await reporting._doInit()
})

afterEach(async () => {
  await reporting._doDestroy()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Sentry consent gate', () => {
  it('links accepted reports to diagnostic logs without copying event content', () => {
    const options = initOptions()
    expect(options.beforeSend({ message: 'private provider response' })).toBeNull()
    expect(mockMainLoggerService.info).not.toHaveBeenCalled()
    grantConsent()
    const event = options.beforeSend({
      message: 'private provider response',
      tags: { 'capture.source': 'log', module: 'agentLoop' }
    })
    expect(event.event_id).toMatch(/^[a-f0-9]{32}$/)
    const references = mockMainLoggerService.info.mock.calls.filter(
      ([message]) => message === 'Error report accepted for delivery'
    )
    expect(references).toHaveLength(1)
    expect(references[0][1]).toMatchObject({ reportId: event.event_id })
    expect(JSON.stringify(references)).not.toContain('private provider response')
    expect(options.beforeSend({ tags: { 'capture.source': 'log', module: 'agentLoop' } })).toBeNull()
    expect(
      mockMainLoggerService.info.mock.calls.filter(([message]) => message === 'Error report accepted for delivery')
    ).toHaveLength(1)
  })

  it('blocks both automatic capture and transport after the reporting service stops', async () => {
    grantConsent()
    const options = initOptions()
    const transport = options.transport({})
    await reporting._doStop()
    expect(options.beforeSend({ message: 'after stop' })).toBeNull()
    await transport.send([{}, []])
    expect(sendMock).not.toHaveBeenCalled()
    await reporting._doInit()
    expect(options.beforeSend({ message: 'after restart' })).not.toBeNull()
  })

  it('applies classification to renderer events at the final main-process boundary', () => {
    grantConsent()
    const options = initOptions()
    expect(
      options.beforeSend({
        tags: {
          'event.process': 'renderer',
          'failure.source': 'sdk',
          'failure.kind': 'expected',
          'failure.reason': 'output_limit',
          'failure.outcome': 'failed',
          'failure.runtime': 'pi'
        }
      })
    ).toBeNull()
    expect(
      options.beforeSend({ exception: { values: [{ type: 'TypeError', value: 'Broken render' }] } })
    ).not.toBeNull()
    expect(
      options.beforeSend({}, { originalException: Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' }) })
    ).toBeNull()
  })

  it.each([
    { label: 'automatic', tags: {} },
    { label: 'legacy log', tags: { 'capture.source': 'log' } },
    { label: 'invalid classification', tags: { 'failure.kind': 'reliability' } }
  ])('limits unclassified $label errors to one per ten minutes', ({ tags }) => {
    grantConsent()
    const options = initOptions()
    const unclassified = { tags: { module: 'Unclassified', ...tags } }
    expect(options.beforeSend(unclassified)).not.toBeNull()
    const classified = {
      tags: {
        module: 'Persistence',
        'failure.source': 'application',
        'failure.kind': 'reliability',
        'failure.reason': 'persistence_failed',
        'failure.outcome': 'failed'
      }
    }
    expect(options.beforeSend(classified)).not.toBeNull()
    expect(options.beforeSend(unclassified)).toBeNull()
    for (let i = 0; i < 4; i++) expect(options.beforeSend(classified)).not.toBeNull()
    expect(options.beforeSend(classified)).toBeNull()
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000 + 1)
    try {
      expect(options.beforeSend(unclassified)).not.toBeNull()
      expect(options.beforeSend(unclassified)).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

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

    expect(initOptions().beforeSend({ message: 'boom' })).toBeNull()
  })

  it('drops events raised during preboot, before any preference store exists', () => {
    grantConsent()
    const options = initOptions()
    vi.mocked(application.getExisting).mockReturnValueOnce(undefined)

    expect(options.beforeSend({ message: 'boom' })).toBeNull()
  })

  it('sanitizes consented error events', () => {
    grantConsent()

    const event = initOptions().beforeSend({ extra: { apiKey: 'real-api-key' } })

    expect(JSON.stringify(event)).not.toContain('real-api-key')
  })

  it('blocks events and envelopes while an existing preference store is not ready', async () => {
    grantConsent()
    const options = initOptions()
    const transport = options.transport({})
    const envelope = [{}, []]

    preferenceState.ready = false
    expect(options.beforeSend({ message: 'starting' })).toBeNull()
    await transport.send(envelope)
    expect(sendMock).not.toHaveBeenCalled()

    preferenceState.ready = true
    expect(options.beforeSend({ message: 'ready' })).not.toBeNull()
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledExactlyOnceWith(envelope)

    preferenceState.ready = false
    expect(options.beforeSend({ message: 'stopped' })).toBeNull()
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

  it('keeps the renderer bridge, dedupe and path scrubbing the rest of the design relies on', () => {
    const configured = initOptions().integrations.map((integration: { name: string }) => integration.name)

    expect(configured).toContain('PreloadInjection')
    expect(configured).toContain('NormalizePaths')
    expect(configured).toContain('OnUncaughtException')
    expect(configured).toContain('Dedupe')
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

    const event = initOptions().beforeSend({
      message: 'boom',
      tags: { 'event.process': process },
      user: { id: 'stale-user-id' }
    })

    expect(event.user.id).toBe(clientId)
    expect(event.tags['event.process']).toBe(process)
  })

  it('uses the same persisted client ID across events for a new installation', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')
    grantConsent()
    const options = initOptions()

    const first = options.beforeSend({ message: 'first error', tags: { module: 'First' } })
    const second = options.beforeSend({ message: 'second error', tags: { module: 'Second' } })

    expect(isUuid(first.user.id)).toBe(true)
    expect(second.user.id).toBe(first.user.id)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe(first.user.id)
  })

  it('does not generate a client ID for an event without consent', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.id', '')

    expect(initOptions().beforeSend({ message: 'boom' })).toBeNull()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.user.id')).toBe('')
  })
})
