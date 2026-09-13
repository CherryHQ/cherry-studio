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
