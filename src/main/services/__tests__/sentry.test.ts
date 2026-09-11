import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { initMock, makeElectronTransportMock, sendMock, flushMock, preferences } = vi.hoisted(() => ({
  initMock: vi.fn(),
  makeElectronTransportMock: vi.fn(),
  sendMock: vi.fn(async () => ({ statusCode: 200 })),
  flushMock: vi.fn(async () => true),
  preferences: {} as Record<string, unknown>
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
  return mockApplicationFactory({
    PreferenceService: { get: (key: string) => preferences[key] }
  })
})

import { application } from '@application'

import { initSentry } from '../sentry'

function grantConsent() {
  preferences['app.privacy.data_collection.enabled'] = true
  preferences['app.privacy.policy_version'] = LATEST_PRIVACY_POLICY_VERSION
}

function initOptions() {
  initSentry()
  return initMock.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEV', false)
  vi.stubGlobal('__APP_EDITION__', 'global')
  makeElectronTransportMock.mockReturnValue({ send: sendMock, flush: flushMock })
  preferences['app.privacy.data_collection.enabled'] = false
  preferences['app.privacy.policy_version'] = ''
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

    preferences['app.privacy.data_collection.enabled'] = false
    await transport.send(envelope)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('treats consent under a superseded privacy policy as no consent', () => {
    preferences['app.privacy.data_collection.enabled'] = true
    preferences['app.privacy.policy_version'] = '20200101'

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

  it('leaves process termination to the app so a crash still runs graceful shutdown', () => {
    expect(initOptions().onFatalError).toBeUndefined()
  })
})
