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
    expect(curl).toContain('display summary only')
  })
})
