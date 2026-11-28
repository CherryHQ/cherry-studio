import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

function loadCurlExport() {
  const scriptPath = join(process.cwd(), 'resources/devtools/main-network/curlExport.js')
  const script = readFileSync(scriptPath, 'utf8')
  const sandbox: { buildCurlCommand?: (event: unknown) => string } = {}
  vm.createContext(sandbox)
  vm.runInContext(`${script}\nthis.buildCurlCommand = buildCurlCommand;`, sandbox)
  if (!sandbox.buildCurlCommand) throw new Error('buildCurlCommand was not defined')
  return sandbox.buildCurlCommand
}

describe('main network cURL export', () => {
  const buildCurlCommand = loadCurlExport()

  it('omits body-framing headers and lets curl size the payload', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/v1/chat',
      requestHeaders: {
        'Content-Type': 'application/json',
        'Content-Length': '99',
        'Transfer-Encoding': 'chunked'
      },
      requestBody: { text: '{"prompt":"hi"}', replayable: true }
    })

    expect(curl).toContain('--data-raw')
    expect(curl).toContain('{"prompt":"hi"}')
    expect(curl).not.toMatch(/content-length/i)
    expect(curl).not.toMatch(/transfer-encoding/i)
  })

  it('preserves GET when exporting a replayable body', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: 'https://api.example/resource',
      requestBody: { text: 'payload', replayable: true }
    })

    expect(curl).toContain('-X')
    expect(curl).toContain("'GET'")
    expect(curl).toContain('--data-raw')
    expect(curl).toContain("'payload'")
  })

  it('exports HEAD requests with --head instead of -X HEAD', () => {
    const curl = buildCurlCommand({
      method: 'HEAD',
      url: 'https://api.example/resource',
      requestHeaders: { Accept: 'application/json', 'Content-Length': '0' }
    })

    expect(curl).toContain('--head')
    expect(curl).not.toMatch(/-X\s+'HEAD'/)
    expect(curl).not.toMatch(/\n\s+--data-raw\b/)
    expect(curl).toContain('Accept')
  })

  it('disables curl URL globbing so bracket query params are preserved', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: 'http://127.0.0.1:1/?filter[model]=x'
    })

    expect(curl).toContain('--globoff')
    expect(curl).toContain('filter[model]=x')
  })

  it('adds captured Content-Type when exporting a body without the header', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/v1',
      requestBody: {
        text: 'plain message',
        contentType: 'text/plain;charset=UTF-8',
        replayable: true
      }
    })

    expect(curl).toContain('text/plain;charset=UTF-8')
    expect(curl).toContain('--data-raw')
    expect(curl).toContain("'plain message'")
  })

  it('suppresses curl default Content-Type when the capture has no media type', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/v1',
      requestBody: { text: 'payload', replayable: true }
    })

    expect(curl).toContain("'Content-Type:'")
    expect(curl).toContain('--data-raw')
  })

  it('exports an empty POST body with inferred Content-Type', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/v1',
      requestBody: {
        text: '',
        contentType: 'text/plain;charset=UTF-8',
        replayable: true
      }
    })

    expect(curl).toContain('--data-raw')
    expect(curl).toMatch(/\n\s+''$/)
    expect(curl).toContain('text/plain;charset=UTF-8')
  })

  it('does not export content-encoded bodies as --data-raw', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/v1',
      requestHeaders: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      requestBody: {
        text: '{"prompt":"hi"}',
        replayable: false,
        note: 'Content-encoded request bodies cannot be replayed from capture.'
      }
    })

    expect(curl).not.toMatch(/\n\s+--data-raw\b/)
    expect(curl).toContain('Content-encoded')
  })

  it('does not send FormData display summaries as --data-raw', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example/upload',
      requestHeaders: { 'Content-Type': 'multipart/form-data' },
      requestBody: {
        text: '{"file":"[file doc.pdf 1024 bytes]"}',
        replayable: false,
        note: 'Multipart FormData cannot be exported as cURL.'
      }
    })

    expect(curl).not.toMatch(/\n\s+--data-raw\b/)
    expect(curl).toContain('Multipart FormData cannot be exported as cURL.')
  })
})

it('defensively omits legacy NUL-bearing captures rather than emitting a lossy shell argument', () => {
  const command = loadCurlExport()({
    method: 'POST',
    url: 'https://example.test',
    requestBody: { text: 'A\0B', replayable: true }
  })
  expect(command).not.toContain('\0')
  expect(command).not.toMatch(/\n\s+--data-raw\b/)
  expect(command).toContain('NUL')
})

it('preserves explicitly empty header values rather than suppressing the header', () => {
  const command = loadCurlExport()({ url: 'https://example.test', requestHeaders: { 'Content-Type': '' } })
  expect(command).toContain("'Content-Type;'")
})
it('preserves repeated raw Node header entries without losing the first value', () => {
  const command = loadCurlExport()({
    url: 'https://example.test',
    requestHeaders: { 'X-Route': 'two' },
    requestHeaderEntries: [
      ['X-Route', 'one'],
      ['X-Route', 'two']
    ]
  })
  expect(command).toContain("'X-Route: one'")
  expect(command).toContain("'X-Route: two'")
})

it('keeps editable commands alongside target and connection warnings', () => {
  const build = loadCurlExport()
  const warning = 'URL path may be normalized; replay can differ from the original Node request target.'
  const event = {
    url: 'https://example.com/b',
    method: 'POST',
    requestReplayWarning: warning,
    requestBody: { text: 'public=1' }
  }
  expect(build(event)).toContain('# ' + warning + '\ncurl ')
  expect(build(event)).toContain('--data-raw')
  expect(
    build({ ...event, requestReplayError: 'Unix socket request cannot faithfully replay through a URL.' })
  ).toContain('curl ')
})

it.each([
  'Unix socket request cannot faithfully replay through a URL.',
  'Authenticated Node request cannot faithfully replay from redacted capture.',
  'Literal Node request target cannot faithfully replay through a URL.',
  'Invalid URL cannot faithfully replay the literal Node request target.'
])('retains captured method, headers and body for an editable export: %s', (note) => {
  const command = loadCurlExport()({
    url: 'http://localhost/a#fragment',
    method: 'POST',
    requestReplayError: note,
    requestHeaders: { Authorization: '[REDACTED]', 'X-Debug': "it's a test" },
    requestBody: { text: 'public=1' }
  })
  expect(command).toContain('# ' + note + '\ncurl ')
  expect(command).toContain("'POST'")
  expect(command).toContain('Authorization: [REDACTED]')
  expect(command).toContain('--data-raw')
  expect(command).toContain("'public=1'")
})
