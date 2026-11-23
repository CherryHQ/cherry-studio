import type { ErrorEvent } from '@sentry/electron/renderer'
import { describe, expect, it } from 'vitest'

import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '../sentry'

describe('Sentry context', () => {
  it.each([undefined, { kind: 'defect' }])('keeps logs without valid failure facts local', (failure) => {
    expect(
      getSentryLogContext({ level: 'error', stack: 'Error: private details', operation: 'react.render', failure })
    ).toBeUndefined()
  })

  it('does not promote expected SDK failures to product defects just because they have a stack', () => {
    expect(
      getSentryLogContext({
        level: 'error',
        stack: 'Error: output limit',
        failure: { source: 'sdk', kind: 'expected', reason: 'output_limit', outcome: 'failed', runtime: 'pi' }
      })
    ).toBeUndefined()
  })

  it('captures a structured process crash without manufacturing a JavaScript stack', () => {
    expect(
      getSentryLogContext({
        level: 'error',
        module: 'MainWindowService',
        operation: 'window.renderer.exit',
        failure: { source: 'application', kind: 'reliability', reason: 'crashed', outcome: 'failed' }
      })?.tags
    ).toMatchObject({ 'failure.kind': 'reliability', 'failure.reason': 'crashed' })
  })

  it('does not report an IPC failure again in its receiving process', () => {
    expect(
      getSentryLogContext({
        level: 'error',
        stack: 'Error: remote error',
        reportingHandled: true,
        failure: { source: 'application', kind: 'defect', reason: 'execution_failed', outcome: 'failed' }
      })
    ).toBeUndefined()
  })

  it.each([
    ['2.0.14', 'stable'],
    ['2.1.0-rc.2', 'rc'],
    ['2.1.0-beta.3', 'beta'],
    ['2.1.0-nightly.20260911', 'nightly']
  ])('labels build %s with channel %s', (version, channel) => {
    expect(getSentryBuildContext('CherryStudio', version, 'cn')).toEqual({
      release: `CherryStudio@${version}`,
      tags: { 'app.version': version, 'app.channel': channel, 'app.edition': 'cn' }
    })
  })

  it('keeps only explicit operation identifiers and excludes business data', () => {
    const info = {
      level: 'error',
      name: 'Error',
      errorMessage: 'Failed',
      stack: 'Error: Failed\n at run (app:///job.js:2:3)',
      operation: 'job.schedule.fire',
      failure: { source: 'application', kind: 'defect', reason: 'execution_failed', outcome: 'failed' },
      module: 'JobManager',
      code: 'SQLITE_BUSY',
      process: 'main',
      scheduleId: 'private-id',
      context: { prompt: 'private conversation' }
    }
    expect(getSentryLogContext(info)).toEqual({
      tags: {
        module: 'JobManager',
        code: 'SQLITE_BUSY',
        operation: 'job.schedule.fire',
        'event.process': 'main',
        'failure.source': 'application',
        'failure.kind': 'defect',
        'failure.reason': 'execution_failed',
        'failure.outcome': 'failed'
      },
      extra: undefined
    })
    expect(getSentryLogContext({ ...info, operation: 'user typed this text' })?.tags).not.toHaveProperty('operation')
  })
})

describe('Sentry event sanitization', () => {
  it.each([
    'https://alice:demo-password@example.com/api',
    'https://alice@example.com/api',
    'https://alice:p%40ss@example.com/api',
    'https://alice:p@ss@example.com/api',
    '//alice:demo-password@example.com/api',
    'socks5://alice:demo-password@[::1]:1080/api'
  ])('removes URL credentials embedded in error text: %s', (url) => {
    const event = {
      type: undefined,
      exception: { values: [{ type: 'Error', value: `Connection failed: ${url}` }] },
      request: { url }
    }

    const sanitized = sanitizeSentryEvent(event)

    for (const secret of ['alice', 'demo-password', 'p%40ss', 'p@ss']) {
      expect(JSON.stringify(sanitized)).not.toContain(secret)
    }
    expect(sanitized.exception?.values?.[0]?.value).toContain('Connection failed: ')
    expect(sanitized.request?.url).toContain('/api')
    expect(event.request.url).toBe(url)
  })

  it('preserves diagnostic URLs and redacts multiple credential-bearing URLs in one message', () => {
    const message =
      'https://alice:demo-password@example.com/a → https://bob:other-password@example.org/b; https://example.net/@scope/pkg?email=dev@example.net'

    expect(sanitizeSentryEvent({ type: undefined, message }).message).toBe(
      'https://<redacted>@example.com/a → https://<redacted>@example.org/b; https://example.net/@scope/pkg?email=dev@example.net'
    )
  })

  it('redacts nested credentials without discarding diagnostic context or mutating the input', () => {
    const event = {
      type: undefined,
      message: 'request failed: Authorization: Bearer real-token',
      extra: { apiKey: 'real-api-key' },
      request: { url: 'https://example.com/callback?code=oauth-secret' },
      exception: { values: [{ type: 'Error', value: 'Storage unavailable' }] },
      tags: { module: 'Translation', code: 'SQLITE_BUSY' }
    }
    const sanitized = sanitizeSentryEvent(event)
    const serialized = JSON.stringify(sanitized)
    for (const secret of ['real-token', 'real-api-key', 'oauth-secret']) expect(serialized).not.toContain(secret)
    expect(sanitized.tags).toEqual(event.tags)
    expect(sanitized.exception).toEqual(event.exception)
    expect(event.extra.apiKey).toBe('real-api-key')
  })

  it('omits sensitive containers and dictionary entries without replacing SDK structures with strings', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        cookies: { theme: 'private-cookie' },
        headers: { Authorization: 'private-header', Accept: 'text/plain' }
      },
      contexts: {
        response: { status_code: 503, cookies: [['theme', 'private-response-cookie']] },
        session: { value: 'private-session' }
      },
      measurements: { secret_count: { value: 42, unit: 'none' }, latency: { value: 10, unit: 'millisecond' } }
    }

    const sanitized = sanitizeSentryEvent(event)

    expect(sanitized.request).toEqual({ headers: { Accept: 'text/plain' } })
    expect(sanitized.contexts).toEqual({ response: { status_code: 503 } })
    expect(sanitized.measurements).toEqual({ latency: { value: 10, unit: 'millisecond' } })
    expect(event.request?.cookies).toEqual({ theme: 'private-cookie' })
    expect(event.contexts?.response?.cookies).toEqual([['theme', 'private-response-cookie']])
    expect(JSON.stringify(sanitized)).not.toContain('private')
  })

  it('keeps the SDK discriminator, grouping fields and opaque processing metadata', () => {
    const sdkProcessingMetadata: NonNullable<ErrorEvent['sdkProcessingMetadata']> = {
      requestSession: { status: 'errored' },
      dynamicSamplingContext: { public_key: 'public-project-key' }
    }
    sdkProcessingMetadata.self = sdkProcessingMetadata
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'fault-id',
      level: 'fatal',
      platform: 'native',
      fingerprint: ['application', 'database.open'],
      exception: {
        values: [{ type: 'Error', value: 'Storage unavailable', mechanism: { type: 'generic', handled: false } }]
      },
      sdkProcessingMetadata
    }

    const sanitized = sanitizeSentryEvent(event)

    expect(Object.hasOwn(sanitized, 'type')).toBe(true)
    expect(sanitized.type).toBeUndefined()
    expect(sanitized.sdkProcessingMetadata).toBe(sdkProcessingMetadata)
    expect(sanitized.event_id).toBe(event.event_id)
    expect(sanitized.level).toBe('fatal')
    expect(sanitized.platform).toBe('native')
    expect(sanitized.fingerprint).toEqual(event.fingerprint)
    expect(sanitized.exception).toEqual(event.exception)
  })

  it('projects native and custom JSON values before redaction without retaining executable toJSON closures', () => {
    let secret = 'original-private-token'
    const custom = { toJSON: () => ({ message: `Authorization: Bearer ${secret}`, token: secret }) }
    const event: ErrorEvent = {
      type: undefined,
      extra: { timestamp: new Date('2026-11-23T00:00:00.000Z'), custom, missing: undefined, values: [undefined] }
    }

    const sanitized = sanitizeSentryEvent(event)
    secret = 'changed-private-token'

    expect(sanitized.extra).toEqual({
      timestamp: '2026-11-23T00:00:00.000Z',
      custom: { message: expect.stringContaining('<redacted>') },
      values: [null]
    })
    expect(JSON.stringify(sanitized)).not.toContain('private-token')
    expect(custom.toJSON().token).toBe('changed-private-token')
    expect(event.extra?.timestamp).toBeInstanceOf(Date)
  })
})
