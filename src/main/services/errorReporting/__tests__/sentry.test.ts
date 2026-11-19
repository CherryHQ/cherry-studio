import { createRequire } from 'node:module'

import type * as SentryMain from '@sentry/electron/main'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { validate as isUuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

type SentryEnvelope = Parameters<ReturnType<typeof SentryMain.makeElectronTransport>['send']>[0]
const sentryRequire = createRequire(createRequire(import.meta.url).resolve('@sentry/electron/main'))
const sentrySdk = sentryRequire('@sentry/node') as Pick<
  typeof SentryMain,
  'NodeClient' | 'Scope' | 'defaultStackParser' | 'dedupeIntegration'
>

const {
  initMock,
  makeElectronTransportMock,
  sendMock,
  flushMock,
  captureEventMock,
  captureExceptionMock,
  preferenceState
} = vi.hoisted(() => ({
  initMock: vi.fn(),
  makeElectronTransportMock: vi.fn(),
  sendMock: vi
    .fn<(envelope: SentryEnvelope) => Promise<{ statusCode: number }>>()
    .mockResolvedValue({ statusCode: 200 }),
  flushMock: vi.fn(async () => true),
  captureEventMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  preferenceState: { ready: true }
}))

// Native instrumentation is stubbed; Dedupe stays real so regressions still
// exercise SDK event processors before beforeSend.
vi.mock('@sentry/electron/main', () => {
  const stub = (name: string) => () => ({ name })
  return {
    init: initMock,
    addIntegration: vi.fn(),
    sentryMinidumpIntegration: stub('SentryMinidump'),
    makeElectronTransport: makeElectronTransportMock,
    dedupeIntegration: () => sentrySdk.dedupeIntegration(),
    captureEvent: captureEventMock,
    captureException: captureExceptionMock,
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
import { captureLoggedError, initSentry } from '../sentry'

let reporting: ErrorReportingService

function grantConsent() {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
  MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
}

function initOptions() {
  initSentry()
  return initMock.mock.calls[0][0]
}

function sdkClient() {
  const client = new sentrySdk.NodeClient({
    ...initOptions(),
    dsn: 'https://public@example.invalid/1',
    stackParser: sentrySdk.defaultStackParser
  })
  client.init()
  captureEventMock.mockImplementation((event) => client.captureEvent(event))
  captureExceptionMock.mockImplementation((error, context) =>
    client.captureException(error, undefined, new sentrySdk.Scope().update(context))
  )
  return client
}

function deliveredReasons() {
  return sendMock.mock.calls.flatMap(([envelope]) =>
    envelope[1]
      .filter(([header]) => header.type === 'event')
      .map(([, event]) => (event as SentryMain.ErrorEvent).tags?.['failure.reason'])
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  captureEventMock.mockReset()
  captureExceptionMock.mockReset()
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
  it('delivers distinct native dumps through the SDK up to the critical hourly budget', async () => {
    grantConsent()
    const client = sdkClient()
    const processes = ['browser', 'renderer', 'gpu', ...Array<string>(8).fill('renderer')]
    const dumps = processes.map((_, index) => new Uint8Array([77, 68, 77, 80, index]))
    try {
      for (const [index, process] of processes.entries()) {
        client.captureEvent(
          {
            platform: 'native',
            level: 'fatal',
            tags: {
              'event.environment': 'native',
              'event.process': process,
              ...(index > 0 ? { 'exit.reason': 'crashed' } : {})
            }
          },
          { attachments: [{ attachmentType: 'event.minidump', filename: `${index}.dmp`, data: dumps[index] }] }
        )
        await client.flush(2000)
      }
      const delivered = sendMock.mock.calls.map(([envelope]) => envelope[1])
      expect(delivered).toHaveLength(10)
      expect(
        delivered.flatMap((items) => items.filter(([header]) => header.type === 'event').map(([, event]) => event))
      ).toEqual(
        processes.slice(0, 10).map((process) =>
          expect.objectContaining({
            platform: 'native',
            level: 'fatal',
            tags: expect.objectContaining({ 'event.process': process })
          })
        )
      )
      expect(
        delivered.flatMap((items) => items.filter(([header]) => header.type === 'attachment').map(([, data]) => data))
      ).toEqual(dumps.slice(0, 10))
      expect(initOptions().beforeSend({ tags: { module: 'ordinary-after-native-crashes' } })).not.toBeNull()
    } finally {
      await client.close(2000)
    }
  })

  it.each(['disabled', 'outdated policy', 'not ready'])(
    'blocks native dumps with %s consent without consuming their budget',
    (state) => {
      grantConsent()
      if (state === 'disabled') {
        MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
      } else if (state === 'outdated policy') {
        MockMainPreferenceServiceUtils.setPreferenceValue('app.privacy.policy_version', '20200101')
      } else {
        preferenceState.ready = false
      }
      const options = initOptions()
      for (let i = 0; i < 11; i++) {
        expect(options.beforeSend({ platform: 'native', level: 'fatal' })).toBeNull()
      }
      grantConsent()
      preferenceState.ready = true
      for (let i = 0; i < 10; i++) {
        expect(options.beforeSend({ platform: 'native', level: 'fatal' })).not.toBeNull()
      }
      expect(options.beforeSend({ platform: 'native', level: 'fatal' })).toBeNull()
    }
  )

  it.each(
    [undefined, 'OperationError: renderer_exit\n    at rendererExit (app/window.js:10:20)'].flatMap((stack) =>
      [
        { nextReason: 'oom', minute: 2 },
        { nextReason: 'crashed', minute: 11 }
      ].map((scenario) => ({ ...scenario, stack, format: stack ? 'exception' : 'stackless event' }))
    )
  )('delivers $nextReason at minute $minute through the SDK ($format)', async ({ stack, nextReason, minute }) => {
    grantConsent()
    const client = sdkClient()
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    const emit = async (reason: string) => {
      captureLoggedError({
        module: 'WindowManager',
        operation: 'window.renderer.exit',
        failure: { source: 'application', kind: 'reliability', reason, outcome: 'failed' },
        ...(stack ? { stack, errorName: 'OperationError', errorMessage: 'renderer_exit' } : {})
      })
      await client.flush(2000)
    }
    try {
      await emit('crashed')
      expect(deliveredReasons()).toEqual(['crashed'])
      now.mockReturnValue(start + 60_000)
      for (let i = 0; i < 12; i++) await emit('crashed')
      expect(deliveredReasons()).toEqual(['crashed'])
      now.mockReturnValue(start + minute * 60_000)
      await emit(nextReason)
      expect(deliveredReasons()).toEqual(['crashed', nextReason])
    } finally {
      now.mockRestore()
      await client.close(2000)
    }
  })

  it('does not let a renderer SDK event before consent suppress its first consented report', async () => {
    const client = sdkClient()
    const emit = async () => {
      client.captureEvent({
        message: 'react.render',
        tags: {
          'event.process': 'renderer',
          'capture.source': 'log',
          operation: 'react.render',
          'failure.source': 'application',
          'failure.kind': 'defect',
          'failure.reason': 'render_failed',
          'failure.outcome': 'failed'
        }
      })
      await client.flush(2000)
    }
    try {
      await emit()
      expect(deliveredReasons()).toEqual([])
      grantConsent()
      await emit()
      expect(deliveredReasons()).toEqual(['render_failed'])
    } finally {
      await client.close(2000)
    }
  })

  it('links accepted reports to diagnostic logs without copying event content', () => {
    const options = initOptions()
    expect(options.beforeSend({ message: 'private provider response' })).toBeNull()
    expect(mockMainLoggerService.info).not.toHaveBeenCalled()
    grantConsent()
    const event = options.beforeSend({
      message: 'private provider response',
      tags: {
        'capture.source': 'log',
        module: 'agentLoop',
        'failure.source': 'application',
        'failure.kind': 'defect',
        'failure.reason': 'execution_failed',
        'failure.outcome': 'failed'
      }
    })
    expect(event.event_id).toMatch(/^[a-f0-9]{32}$/)
    const references = mockMainLoggerService.info.mock.calls.filter(
      ([message]) => message === 'Error report accepted for delivery'
    )
    expect(references).toHaveLength(1)
    expect(references[0][1]).toMatchObject({ reportId: event.event_id })
    expect(JSON.stringify(references)).not.toContain('private provider response')
    expect(options.beforeSend({ tags: event.tags })).toBeNull()
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
    expect(options.beforeSend(classified)).toBeNull()
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000 + 1)
    try {
      expect(options.beforeSend(unclassified)).not.toBeNull()
      expect(options.beforeSend(unclassified)).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it.each([{}, { 'failure.kind': 'reliability' }])('rejects unclassified log events at the final boundary', (tags) => {
    grantConsent()
    const options = initOptions()
    expect(options.beforeSend({ tags: { ...tags, 'capture.source': 'log', operation: 'react.render' } })).toBeNull()
    expect(
      options.beforeSend({ exception: { values: [{ type: 'Error', mechanism: { type: 'onerror', handled: false } }] } })
    ).not.toBeNull()
  })

  it.each(['storage.write', 'window.renderer.exit'])(
    'keeps the first classified sample without exhausting capacity for a distinct failure: %s',
    (operation) => {
      grantConsent()
      const options = initOptions()
      const event = (reason: string, message: string) => ({
        tags: {
          operation,
          'failure.source': 'application',
          'failure.kind': 'reliability',
          'failure.reason': reason,
          'failure.outcome': 'failed'
        },
        exception: { values: [{ type: 'Error', value: message }] }
      })
      const samples = Array.from({ length: 10 }, (_, i) =>
        options.beforeSend(event(i % 2 ? 'second_fault' : 'first_fault', `occurrence ${i}`))
      )
      expect(options.beforeSend(event('third_fault', 'different failure'))).not.toBeNull()
      expect(samples.filter(Boolean)).toHaveLength(2)
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000 + 1)
      try {
        expect(options.beforeSend(event('first_fault', 'next window'))).not.toBeNull()
        expect(options.beforeSend(event('first_fault', 'duplicate'))).toBeNull()
      } finally {
        now.mockRestore()
      }
    }
  )

  it.each([
    {
      tags: {
        operation: 'window.renderer.exit',
        'failure.source': 'application',
        'failure.kind': 'reliability',
        'failure.reason': 'crashed',
        'failure.outcome': 'failed'
      }
    },
    {
      tags: {
        operation: 'react.render',
        'capture.source': 'log',
        'failure.source': 'application',
        'failure.kind': 'defect',
        'failure.reason': 'render_failed',
        'failure.outcome': 'failed'
      }
    },
    { level: 'fatal' },
    { exception: { values: [{ type: 'Error', mechanism: { type: 'onuncaughtexception', handled: false } }] } }
  ])('reserves critical capacity after ordinary reports exhaust their budget: %j', (critical) => {
    grantConsent()
    const options = initOptions()
    const ordinary = Array.from({ length: 50 }, (_, i) => options.beforeSend({ tags: { module: `ordinary${i}` } }))
    expect(options.beforeSend(critical)).not.toBeNull()
    expect(ordinary.filter(Boolean)).toHaveLength(10)
    for (let i = 1; i < 10; i++) {
      expect(
        options.beforeSend({
          ...critical,
          tags: { ...('tags' in critical ? critical.tags : {}), module: `critical${i}` }
        })
      ).not.toBeNull()
    }
    expect(
      options.beforeSend({
        ...critical,
        tags: { ...('tags' in critical ? critical.tags : {}), module: 'critical-overflow' }
      })
    ).toBeNull()
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000 + 1)
    try {
      expect(options.beforeSend({ tags: { module: 'ordinary-after-ten-minutes' } })).toBeNull()
      now.mockReturnValue(Date.now() + 50 * 60 * 1000)
      expect(options.beforeSend({ tags: { module: 'ordinary-after-one-hour' } })).not.toBeNull()
      expect(options.beforeSend(critical)).not.toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it('keeps ordinary capacity independent and resets both budgets on service restart', async () => {
    grantConsent()
    const options = initOptions()
    for (let i = 0; i < 10; i++) {
      expect(options.beforeSend({ level: 'fatal', tags: { module: `critical${i}` } })).not.toBeNull()
    }
    expect(options.beforeSend({ level: 'fatal', tags: { module: 'critical-overflow' } })).toBeNull()
    expect(options.beforeSend({ tags: { module: 'ordinary' } })).not.toBeNull()
    await reporting._doStop()
    await reporting._doInit()
    expect(options.beforeSend({ level: 'fatal', tags: { module: 'critical0' } })).not.toBeNull()
    expect(options.beforeSend({ tags: { module: 'ordinary' } })).not.toBeNull()
  })

  it('does not initialize in development even with reporting consent', () => {
    vi.stubEnv('DEV', true)
    grantConsent()

    initSentry()

    expect(initMock).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'error', envelope: [{}, []] },
    {
      kind: 'native crash',
      envelope: [
        {},
        [
          [{ type: 'event' }, { platform: 'native', level: 'fatal' }],
          [{ type: 'attachment', attachment_type: 'event.minidump' }, new Uint8Array([77, 68, 77, 80])]
        ]
      ]
    }
  ])('sends $kind envelopes only while the user consents', async ({ envelope }) => {
    const transport = initOptions().transport({})

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

  it('keeps the renderer bridge and path scrubbing the rest of the design relies on', () => {
    const configured = initOptions().integrations.map((integration: { name: string }) => integration.name)

    expect(configured).toContain('PreloadInjection')
    expect(configured).toContain('NormalizePaths')
    expect(configured).toContain('OnUncaughtException')
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
