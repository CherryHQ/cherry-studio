import { describe, expect, it } from 'vitest'

import { redactUrlCredentials } from '../redactUrlCredentials'

describe('redactUrlCredentials', () => {
  it.each([
    ['long plain text', 'a'.repeat(200_000)],
    ['a base64 data URI', `data:image/png;base64,${'YWJj'.repeat(50_000)}`],
    ['scheme-like text', 'a.'.repeat(100_000)],
    ['a long authority without credentials', `http://${'a'.repeat(64_000)}`],
    ['many URL prefixes without credentials', 'http://'.repeat(8_000)]
  ])('preserves %s without repeated scanning', (_name, input) => {
    const started = performance.now()
    const output = redactUrlCredentials(input)
    const elapsed = performance.now() - started

    expect(output).toBe(input)
    expect(elapsed).toBeLessThan(250)
  })

  it.each([
    ['http://user:pass@host:8080', 'http://<redacted>:<redacted>@host:8080'],
    ['socks5://user:pass@host:1080', 'socks5://<redacted>:<redacted>@host:1080'],
    ['Failed to parse http://u:hunter2@host:abc today', 'Failed to parse http://<redacted>:<redacted>@host:abc today'],
    ['http://u:p%40ss@host', 'http://<redacted>:<redacted>@host'],
    ['http://u:sec@ret@host', 'http://<redacted>:<redacted>@host'],
    ['socks5://u:sec@re@t@host:1080', 'socks5://<redacted>:<redacted>@host:1080'],
    [
      'http://u:sec@ret@first/path https://v:pa@ss@second',
      'http://<redacted>:<redacted>@first/path https://<redacted>:<redacted>@second'
    ],
    ['https://sk-live-abc@api.example/mcp', 'https://<redacted>:<redacted>@api.example/mcp'],
    ['http://host:8080/path?q=1', 'http://host:8080/path?q=1'],
    ['http://host:8080/x@y', 'http://host:8080/x@y'],
    ['https://host?q=u:secret@example', 'https://host?q=u:secret@example'],
    ['https://host#u:secret@example', 'https://host#u:secret@example'],
    ['mailto:x@y', 'mailto:x@y'],
    ['x[http://u:secret@host]', 'x[http://<redacted>:<redacted>@host]'],
    ['ssh://git@host/repo', 'ssh://<redacted>:<redacted>@host/repo'],
    ['1://u:secret@host', '1://u:secret@host'],
    ['://u:secret@host', '://u:secret@host'],
    ['custom+v1.2-proxy://u:secret@HOST:abc', 'custom+v1.2-proxy://<redacted>:<redacted>@HOST:abc'],
    ['HTTP://:secret@[::1]:8080', 'HTTP://<redacted>:<redacted>@[::1]:8080'],
    ['http://user:@host', 'http://<redacted>:<redacted>@host'],
    ['http://@host', 'http://<redacted>:<redacted>@host'],
    [
      'http://u:secret@host/PATH?q=Keep%2FCase#fragment',
      'http://<redacted>:<redacted>@host/PATH?q=Keep%2FCase#fragment'
    ],
    ['http://u:secret@http://v:secret@host', 'http://<redacted>:<redacted>@http://<redacted>:<redacted>@host'],
    [
      'http://u:secret@host\nsocks5://v:secret@host',
      'http://<redacted>:<redacted>@host\nsocks5://<redacted>:<redacted>@host'
    ],
    ['ordinary non-URL text', 'ordinary non-URL text']
  ])('redacts credentials without requiring a valid URL: %s', (input, expected) => {
    expect(redactUrlCredentials(input)).toBe(expected)
  })

  it.each([
    ['http://user:ab/cd@proxy:8080', 'http://<redacted>:<redacted>@proxy:8080'],
    ['http://user:ab?cd@proxy:8080', 'http://<redacted>:<redacted>@proxy:8080'],
    ['http://user:ab#cd@proxy:8080', 'http://<redacted>:<redacted>@proxy:8080'],
    [
      'TypeError: fetch failed for http://user:ab/cd@proxy:8080 (ECONNREFUSED)',
      'TypeError: fetch failed for http://<redacted>:<redacted>@proxy:8080 (ECONNREFUSED)'
    ],
    ['Failed (http://user:ab/cd@proxy:8080).', 'Failed (http://<redacted>:<redacted>@proxy:8080).'],
    ['socks5://user:ab/cd@[bad', 'socks5://<redacted>:<redacted>@[bad']
  ])('fails closed on a URL that does not parse: %s', (input, expected) => {
    expect(redactUrlCredentials(input)).toBe(expected)
  })

  it.each([
    'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.0.0/dist/standalone.js',
    'https://api.github.com/users/@me',
    'https://host/path?email=a@b.com',
    'Reading https://registry.npmjs.org/@cherrystudio/ui.'
  ])('leaves a parseable URL whose @ is outside the authority untouched: %s', (input) => {
    expect(redactUrlCredentials(input)).toBe(input)
  })

  it('is idempotent so callers can safely compose redaction', () => {
    const redacted = 'http://<redacted>:<redacted>@host/path socks5://<redacted>:<redacted>@[::1]:1080'
    expect(redactUrlCredentials(redacted)).toBe(redacted)
  })
})
