import { describe, expect, it } from 'vitest'

import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '../sentry'

describe('Sentry context', () => {
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
      module: 'JobManager',
      code: 'SQLITE_BUSY',
      process: 'main',
      scheduleId: 'private-id',
      context: { prompt: 'private conversation' }
    }
    expect(getSentryLogContext(info)).toEqual({
      tags: { module: 'JobManager', code: 'SQLITE_BUSY', operation: 'job.schedule.fire', 'event.process': 'main' },
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
      exception: { values: [{ type: 'Error', value: `Connection failed: ${url}` }] },
      request: { url }
    }

    const sanitized = sanitizeSentryEvent(event)

    for (const secret of ['alice', 'demo-password', 'p%40ss', 'p@ss']) {
      expect(JSON.stringify(sanitized)).not.toContain(secret)
    }
    expect(sanitized.exception.values[0].value).toContain('Connection failed: ')
    expect(sanitized.request.url).toContain('/api')
    expect(event.request.url).toBe(url)
  })

  it('preserves diagnostic URLs and redacts multiple credential-bearing URLs in one message', () => {
    const message =
      'https://alice:demo-password@example.com/a → https://bob:other-password@example.org/b; https://example.net/@scope/pkg?email=dev@example.net'

    expect(sanitizeSentryEvent({ message }).message).toBe(
      'https://<redacted>@example.com/a → https://<redacted>@example.org/b; https://example.net/@scope/pkg?email=dev@example.net'
    )
  })

  it('redacts nested credentials without discarding diagnostic context or mutating the input', () => {
    const event = {
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
})
