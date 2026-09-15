import { describe, expect, it } from 'vitest'

import { getSentryBuildContext, getSentryLogContext, redactSentryEventPaths, sanitizeSentryEvent } from '../sentry'

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

describe('Sentry event path redaction', () => {
  it('rewrites the home directory in messages and component stacks while keeping normalized frames', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value:
              "EPERM: operation not permitted, unlink 'C:\\Users\\John Smith\\AppData\\Roaming\\CherryStudio\\Data\\app.db'",
            stacktrace: { frames: [{ filename: 'app:///out/main/index.js', lineno: 12, colno: 34 }] }
          }
        ]
      },
      extra: {
        componentStack:
          '\n    at Foo (file:///C:/Users/John%20Smith/AppData/Local/Programs/Cherry%20Studio/resources/app.asar/out/renderer/assets/index-abc.js:12:34)\n    at div'
      },
      request: { url: 'app:///out/renderer/index.html' },
      tags: { module: 'FileStorage', code: 'EPERM', 'event.process': 'main' }
    }

    const redacted = redactSentryEventPaths(event, 'C:\\Users\\John Smith')

    const serialized = JSON.stringify(redacted)
    for (const identity of ['John Smith', 'John%20Smith']) expect(serialized).not.toContain(identity)
    expect(redacted.exception.values[0].value).toBe(
      "EPERM: operation not permitted, unlink '~\\AppData\\Roaming\\CherryStudio\\Data\\app.db'"
    )
    expect(redacted.extra.componentStack).toBe(
      '\n    at Foo (~/AppData/Local/Programs/Cherry%20Studio/resources/app.asar/out/renderer/assets/index-abc.js:12:34)\n    at div'
    )
    expect(redacted.exception.values[0].stacktrace).toEqual(event.exception.values[0].stacktrace)
    expect(redacted.request).toEqual(event.request)
    expect(redacted.tags).toEqual(event.tags)
    expect(event.exception.values[0].value).toContain('John Smith')
  })

  it('sanitizeSentryEvent leaves raw renderer frame filenames for the SDK path normalizer', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'x is not a function',
            stacktrace: {
              frames: [
                {
                  filename:
                    'file:///C:/Users/John%20Smith/AppData/Local/Programs/Cherry%20Studio/resources/app.asar/out/renderer/assets/index-abc.js'
                }
              ]
            }
          }
        ]
      },
      request: {
        url: 'file:///C:/Users/John%20Smith/AppData/Local/Programs/Cherry%20Studio/resources/app.asar/out/renderer/index.html'
      }
    }

    expect(sanitizeSentryEvent(event)).toEqual(event)
  })
})
