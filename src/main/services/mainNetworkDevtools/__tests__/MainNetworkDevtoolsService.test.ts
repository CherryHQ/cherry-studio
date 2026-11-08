import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, get as httpGet, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import vm from 'node:vm'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { BaseService } from '@main/core/lifecycle'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    isReady: vi.fn(() => false),
    on: vi.fn(),
    removeListener: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve())
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  net: {
    fetch: vi.fn()
  }
}))

vi.mock('@main/core/devtools', () => ({
  installBundledDevtools: vi.fn()
}))

import { installBundledDevtools } from '@main/core/devtools'

import {
  captureRequestBody,
  describeHttpRequest,
  getEffectiveFetchRequestContentType,
  type MainNetworkDevtoolsEvent,
  MainNetworkDevtoolsService,
  redactHeaders,
  redactUrl
} from '../MainNetworkDevtoolsService'

describe('MainNetworkDevtoolsService helpers', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('redacts sensitive URL credentials and query params', () => {
    expect(redactUrl('https://user:pass@example.com/v1/chat?api_key=secret&model=test&token=abc')).toBe(
      'https://%3Credacted%3E:%3Credacted%3E@example.com/v1/chat?api_key=%3Credacted%3E&model=test&token=%3Credacted%3E'
    )
  })

  it('redacts sensitive headers', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'X-Trace-Id': 'trace-id',
        'X-Api-Token': 'token'
      })
    ).toEqual({
      Authorization: '<redacted>',
      Cookie: '<redacted>',
      'X-Trace-Id': 'trace-id',
      'X-Api-Token': '<redacted>'
    })
  })

  it('describes Node http request arguments without leaking secrets', () => {
    const description = describeHttpRequest('https', [
      'https://example.com/v1/chat?token=abc',
      {
        method: 'post',
        headers: {
          Authorization: 'Bearer secret',
          Accept: 'application/json'
        }
      }
    ])

    expect(description).toEqual({
      method: 'POST',
      url: 'https://example.com/v1/chat?token=%3Credacted%3E',
      requestHeaders: {
        Authorization: '<redacted>',
        Accept: 'application/json'
      }
    })
  })

  it('captures JSON request and response bodies without consuming Electron net.fetch responses', async () => {
    const originalNetFetch = vi.mocked(net.fetch)
    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
    originalNetFetch.mockResolvedValue(response)

    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      patchNetFetch: () => void
    }
    serviceState.patchNetFetch()

    try {
      expect(net.fetch).not.toBe(originalNetFetch)
      const result = await net.fetch('https://api.test/v1/chat?token=secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"token":"secret","message":"hello"}'
      })

      await expect(result.text()).resolves.toBe('{"ok":true}')
      await waitFor(() => serviceState.events[0]?.responseBody !== undefined)

      expect(serviceState.events[0]?.requestBody?.text).toBe('{"token":"<redacted>","message":"hello"}')
      expect(serviceState.events[0]?.responseBody?.text).toBe('{"ok":true}')
    } finally {
      await service._doStop()
    }

    expect(net.fetch).toBe(originalNetFetch)
  })

  it('does not clone non-text response bodies so the tee cannot buffer binary payloads', async () => {
    const originalNetFetch = vi.mocked(net.fetch)
    const response = new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    })
    const cloneSpy = vi.spyOn(response, 'clone')
    originalNetFetch.mockResolvedValue(response)

    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      patchNetFetch: () => void
    }
    serviceState.patchNetFetch()

    try {
      const result = await net.fetch('https://api.test/download')
      await waitFor(() => serviceState.events[0]?.responseBody !== undefined)

      // Skipping the clone means the body is never teed, so no unread branch can buffer.
      expect(cloneSpy).not.toHaveBeenCalled()
      expect(serviceState.events[0]?.responseBody).toMatchObject({
        contentType: 'application/octet-stream',
        note: 'Binary response body is not captured.'
      })
      // The original response is untouched and still fully readable by the real caller.
      await expect(result.arrayBuffer()).resolves.toHaveProperty('byteLength', 4)
    } finally {
      await service._doStop()
    }

    expect(net.fetch).toBe(originalNetFetch)
  })

  it('marks non-2xx Electron net.fetch responses as error', async () => {
    const originalNetFetch = vi.mocked(net.fetch)
    const response = new Response('bad request', {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'text/plain' }
    })
    originalNetFetch.mockResolvedValue(response)

    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      patchNetFetch: () => void
    }
    serviceState.patchNetFetch()

    try {
      await expect(net.fetch('https://api.test/v1/chat')).resolves.toBe(response)
      expect(serviceState.events[0]).toMatchObject({
        state: 'error',
        status: 400,
        statusText: 'Bad Request',
        error: 'HTTP 400 Bad Request'
      })
    } finally {
      await service._doStop()
    }

    expect(net.fetch).toBe(originalNetFetch)
  })

  it('captures and redacts common request body shapes', () => {
    expect(getEffectiveFetchRequestContentType(undefined, 'plain message')).toBe('text/plain;charset=UTF-8')
    expect(getEffectiveFetchRequestContentType({}, 'plain message')).toBe('text/plain;charset=UTF-8')
    expect(getEffectiveFetchRequestContentType({ 'Content-Type': 'application/json' }, 'plain message')).toBe(
      'application/json'
    )
    expect(
      captureRequestBody('plain message', getEffectiveFetchRequestContentType({}, 'plain message'))?.contentType
    ).toBe('text/plain;charset=UTF-8')

    expect(captureRequestBody('{"api_key":"secret","prompt":"hi"}', 'application/json')?.text).toBe(
      '{"api_key":"<redacted>","prompt":"hi"}'
    )
    expect(captureRequestBody(new URLSearchParams({ token: 'secret', query: 'hello' }))?.text).toBe(
      'token=%3Credacted%3E&query=hello'
    )
  })

  it('marks multipart FormData bodies as non-replayable display summaries', () => {
    const formData = new FormData()
    formData.append('file', new Blob(['hello'], { type: 'text/plain' }), 'doc.txt')

    expect(captureRequestBody(formData)).toMatchObject({
      replayable: false,
      note: 'Multipart FormData cannot be exported as cURL.'
    })
  })

  it('truncates large multipart FormData display summaries like other text bodies', () => {
    const formData = new FormData()
    formData.append('prompt', 'x'.repeat(200 * 1024))

    const captured = captureRequestBody(formData)
    expect(captured?.text).toBeUndefined()
    expect(captured).toMatchObject({
      truncated: true,
      replayable: false,
      note: 'Multipart FormData cannot be exported as cURL.'
    })
  })

  it('marks content-encoded request bodies as non-replayable', () => {
    expect(captureRequestBody('{"prompt":"hi"}', 'application/json', { 'content-encoding': 'gzip' })).toMatchObject({
      replayable: false,
      note: 'Content-encoded request bodies cannot be replayed from capture.'
    })
  })

  it('preserves large JSON integers in display while marking the body non-replayable', () => {
    const captured = captureRequestBody('{"record_id":9007199254740993,"api_key":"secret"}', 'application/json')

    expect(captured?.text).toContain('9007199254740993')
    expect(captured?.text).toContain('"api_key":"<redacted>"')
    expect(captured).toMatchObject({
      replayable: false,
      note: 'JSON integer precision cannot be preserved for cURL replay.'
    })
  })

  it('marks decimal and exponent JSON identifiers as non-replayable', () => {
    expect(captureRequestBody('{"record_id":9007199254740993.0}', 'application/json')).toMatchObject({
      replayable: false
    })
    expect(captureRequestBody('{"record_id":9.007199254740993e15}', 'application/json')).toMatchObject({
      replayable: false
    })
  })

  it('redacts non-string sensitive JSON values when preserving integer literals', () => {
    const captured = captureRequestBody(
      '{"record_id":9007199254740993,"credentials":{"value":"secret"},"token":["secret"],"code":123456}',
      'application/json'
    )

    expect(captured?.text).toContain('9007199254740993')
    expect(captured?.text).toContain('"credentials":"<redacted>"')
    expect(captured?.text).toContain('"token":"<redacted>"')
    expect(captured?.text).toContain('"code":"<redacted>"')
    expect(captured?.text).not.toContain('secret')
  })

  it('redacts a sensitive parent whole even when nested sensitive keys sit under it', () => {
    const captured = captureRequestBody(
      '{"id":9007199254740993,"credentials":{"token":0,"key":0,"pass":0,"value":"TOP_SECRET"}}',
      'application/json'
    )

    expect(captured?.text).toContain('9007199254740993')
    expect(captured?.text).toContain('"credentials":"<redacted>"')
    expect(captured?.text).not.toContain('TOP_SECRET')
  })

  it('marks root-level and fractional precision-losing JSON numbers as non-replayable', () => {
    expect(captureRequestBody('9007199254740993', 'application/json')).toMatchObject({ replayable: false })
    expect(captureRequestBody('{"record_id":9007199254740992.5}', 'application/json')).toMatchObject({
      replayable: false
    })
    expect(captureRequestBody('{"n":1.50,"m":42}', 'application/json')).not.toMatchObject({ replayable: false })
  })

  it('scans a large JSON string value in linear time without flagging digits inside strings', () => {
    const body = JSON.stringify({ prompt: `count:${'1'.repeat(60000)}` })
    const start = performance.now()
    const captured = captureRequestBody(body, 'application/json')
    expect(performance.now() - start).toBeLessThan(500)
    expect(captured).not.toMatchObject({ replayable: false })
  })

  it('marks overflowing JSON numbers as non-replayable and keeps the literal for display', () => {
    const captured = captureRequestBody('{"amount":1e309,"api_key":"secret"}', 'application/json')
    expect(captured).toMatchObject({ replayable: false })
    expect(captured?.text).toContain('1e309')
    expect(captured?.text).not.toContain('secret')
    expect(captureRequestBody('{"amount":-1e309}', 'application/json')).toMatchObject({ replayable: false })
    expect(captureRequestBody('{"amount":1e30,"ok":"1e309"}', 'application/json')).not.toMatchObject({
      replayable: false
    })
  })

  it('redacts precision-sensitive JSON with many escaped quotes without suffix rescans', () => {
    const body = `{"id":9007199254740993,"prompt":${JSON.stringify('"'.repeat(60000))},"credentials":{"token":"private-marker"}}`
    const start = performance.now()
    const captured = captureRequestBody(body, 'application/json')
    expect(performance.now() - start).toBeLessThan(500)
    expect(captured).toMatchObject({ replayable: false })
    expect(captured?.text).toContain('9007199254740993')
    expect(captured?.text).not.toContain('private-marker')
    expect(JSON.parse(captured?.text ?? '{}').credentials).toBe('<redacted>')
  })

  it('keeps sensitive malformed JSON keys redacted on the precision-preserving path', () => {
    for (const key of [String.raw`token\q`, String.raw`session\uZZZZ`, 'token\u0001']) {
      const captured = captureRequestBody(`{"id":9007199254740993,"${key}":"leak-marker"}`, 'application/json')
      expect(captured).toMatchObject({ replayable: false })
      expect(captured?.text).toContain('<redacted>')
      expect(captured?.text).not.toContain('leak-marker')
    }
  })

  it('assembles thousands of sensitive replacements without repeated whole-body copies', () => {
    const fields = Array.from({ length: 8000 }, (_, i) => `"token${i}":0`).join(',')
    const body = `{"id":9007199254740993,${fields}}`
    const originalSlice = String.prototype.slice
    let slicedCharacters = 0
    const sliceSpy = vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start, end) {
      const result = originalSlice.call(this, start, end)
      slicedCharacters += result.length
      if (slicedCharacters > body.length * 10) throw new Error('redaction exceeded linear copy budget')
      return result
    })
    let captured: ReturnType<typeof captureRequestBody>
    try {
      captured = captureRequestBody(body, 'application/json')
    } finally {
      sliceSpy.mockRestore()
    }
    // Measures copied characters rather than a loaded-CI wall-clock threshold.
    expect(slicedCharacters).toBeLessThan(body.length * 10)
    expect(captured).toMatchObject({ replayable: false })
    expect(captured?.text?.match(/<redacted>/g)).toHaveLength(8000)
  })

  it('preserves split multibyte UTF-8 and rejects invalid streamed Node request bytes', async () => {
    for (const chunks of [
      [Buffer.from([0xe2]), Buffer.from([0x82, 0xac])],
      [Buffer.from([0x80]), Buffer.from([0xff])]
    ]) {
      BaseService.resetInstances()
      const service = new MainNetworkDevtoolsService()
      const state = service as unknown as {
        events: MainNetworkDevtoolsEvent[]
        wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
      }
      const request = createMockClientRequest()
      state.wrapHttpMethod(() => request, 'http')('http://example.test', { method: 'POST' })
      request.write(chunks[0])
      request.end(chunks[1])
      await Promise.resolve()
      if (chunks[0][0] === 0xe2) {
        expect(state.events[0].requestBody).toMatchObject({ text: '€', replayable: true })
      } else {
        expect(state.events[0].requestBody).toMatchObject({ replayable: false })
        expect(state.events[0].requestBody?.text).toBeUndefined()
      }
    }
  })

  it.skipIf(process.platform === 'win32')(
    'replays split UTF-8 Node writes byte-for-byte against a disposable local server',
    async () => {
      const received: Buffer[] = []
      const server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          received.push(Buffer.concat(chunks))
          res.end('ok')
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      try {
        for (const chunks of [
          [
            Buffer.concat([Buffer.from('{"prompt":"'), Buffer.from([0xe2])]),
            Buffer.concat([Buffer.from([0x82, 0xac]), Buffer.from('"}')])
          ],
          [Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plain text')],
          [Buffer.from([0xef]), Buffer.concat([Buffer.from([0xbb, 0xbf]), Buffer.from('split BOM')])],
          [Buffer.from([0xef]), Buffer.from([0xbb, 0xbf])]
        ]) {
          BaseService.resetInstances()
          const service = new MainNetworkDevtoolsService()
          const state = service as unknown as {
            events: MainNetworkDevtoolsEvent[]
            wrapHttpMethod: (
              original: (...args: unknown[]) => unknown,
              source: 'http'
            ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
          }
          const wrapped = state.wrapHttpMethod(httpRequest as (...args: unknown[]) => unknown, 'http')
          const req = wrapped(`http://127.0.0.1:${address.port}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
          const completed = new Promise<void>((resolve, reject) => {
            req.on('response', (res) => {
              res.resume()
              res.on('end', resolve)
            })
            req.on('error', reject)
          })
          req.write(chunks[0])
          req.end(chunks[1])
          await completed
          const event = state.events[0]
          expect(event.requestBody).toMatchObject({ text: Buffer.concat(chunks).toString('utf8'), replayable: true })
          const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
          vm.createContext(sandbox)
          vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
          const command = sandbox.buildCurlCommand?.(event)
          expect(command).toBeDefined()
          await promisify(execFile)('/bin/sh', ['-c', command as string], { timeout: 5000 })
          expect(received.at(-1)).toEqual(received.at(-2))
          expect(received.at(-1)).toEqual(Buffer.concat(chunks))
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )

  it('never marks invalid UTF-8 byte bodies as replayable', () => {
    const bytes = Uint8Array.from([0x80, 0xff, 0x41])
    for (const body of [bytes, bytes.buffer, Buffer.from(bytes)]) {
      expect(captureRequestBody(body)).toMatchObject({ replayable: false, size: 3 })
      expect(captureRequestBody(body)?.text).toBeUndefined()
    }
    expect(captureRequestBody(Buffer.from('plain UTF-8 text'))).toMatchObject({
      text: 'plain UTF-8 text',
      replayable: true
    })
  })

  it('marks gzip-compressed binary JSON bodies as non-replayable', () => {
    const body = Buffer.from('{"prompt":"hi"}', 'utf8')
    expect(captureRequestBody(body, 'application/json', { 'content-encoding': 'gzip' })).toMatchObject({
      replayable: false,
      note: 'Content-encoded request bodies cannot be replayed from capture.'
    })
  })

  it('allows only registered DevTools extension origins', () => {
    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      registerOrigin: (origin: string) => void
      isOriginAllowed: (origin: string | undefined) => boolean
    }

    expect(serviceState.isOriginAllowed(undefined)).toBe(false)
    expect(serviceState.isOriginAllowed('http://localhost:3000')).toBe(false)

    serviceState.registerOrigin('chrome-extension://main-network-id')

    expect(serviceState.isOriginAllowed('chrome-extension://main-network-id')).toBe(true)
    expect(serviceState.isOriginAllowed('chrome-extension://other-id')).toBe(false)
  })

  it('installs its own bundled panel once the app is ready and allowlists the resolved extension origin', async () => {
    vi.mocked(installBundledDevtools).mockImplementation(async (_directoryName, _displayName, onInstalled) => {
      onInstalled?.({ id: 'main-network-id', name: 'Main Network' })
    })

    const service = new MainNetworkDevtoolsService()
    // Panel install must hang off onAllReady, not onInit: this service runs in the
    // Background phase, which starts before app.whenReady() resolves.
    await service._doAllReady()

    expect(installBundledDevtools).toHaveBeenCalledWith('main-network', 'Main Network', expect.any(Function))
    const serviceState = service as unknown as { isOriginAllowed: (origin: string | undefined) => boolean }
    expect(serviceState.isOriginAllowed('chrome-extension://main-network-id')).toBe(true)
  })

  it('enforces the registered DevTools extension origin on live websocket connections', async () => {
    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      registerOrigin: (origin: string) => void
      startWebSocketServer: (port?: number) => Promise<number>
    }
    serviceState.registerOrigin('chrome-extension://main-network-id')
    const port = await serviceState.startWebSocketServer(0)

    try {
      await expect(waitForRejectedSocket(port, 'https://evil.example')).resolves.toBe(1008)

      const { socket, message } = await openSocketWithMessage(port, 'chrome-extension://main-network-id')
      try {
        expect(message).toEqual({ type: 'snapshot', events: [] })
      } finally {
        socket.close()
      }
    } finally {
      await service._doStop()
    }
  })

  it('does not attach a data listener when observing Node http responses', () => {
    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        originalMethod: (...args: unknown[]) => unknown,
        source: 'http' | 'https'
      ) => (...args: unknown[]) => unknown
    }
    const request = createMockClientRequest()
    const wrappedRequest = serviceState.wrapHttpMethod(() => request, 'http')

    expect(wrappedRequest('http://example.test')).toBe(request)

    const response = Object.assign(new EventEmitter(), {
      headers: { 'content-type': 'text/plain' },
      statusCode: 200,
      statusMessage: 'OK'
    })
    request.emit('response', response)

    expect(response.listenerCount('data')).toBe(0)
    expect(serviceState.events[0]).toMatchObject({
      state: 'success',
      status: 200,
      statusText: 'OK',
      responseBody: {
        contentType: 'text/plain',
        note: 'Node http/https response body capture is skipped to avoid changing stream consumption.'
      }
    })
  })

  it('marks Node http events as error when request creation throws synchronously', () => {
    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        originalMethod: (...args: unknown[]) => unknown,
        source: 'http' | 'https'
      ) => (...args: unknown[]) => unknown
    }
    const wrappedRequest = serviceState.wrapHttpMethod(() => {
      throw new Error('invalid request')
    }, 'https')

    expect(() => wrappedRequest('https://example.test')).toThrow('invalid request')
    expect(serviceState.events[0]).toMatchObject({
      source: 'https',
      state: 'error',
      error: 'invalid request',
      completedAt: expect.any(Number),
      duration: expect.any(Number)
    })
  })
})

function openSocketWithMessage(port: number, origin: string): Promise<{ socket: WebSocket; message: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { Origin: origin } })
    const timeout = setTimeout(() => {
      cleanup()
      socket.terminate()
      reject(new Error('Timed out waiting for websocket message'))
    }, 1000)
    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('message', handleMessage)
      socket.off('close', handleClose)
      socket.off('error', handleError)
    }
    const handleMessage = (raw: WebSocket.RawData) => {
      cleanup()
      try {
        resolve({ socket, message: JSON.parse(raw.toString()) })
      } catch (error) {
        reject(error)
      }
    }
    const handleClose = (code: number) => {
      cleanup()
      reject(new Error(`Websocket closed before first message: ${code}`))
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    socket.once('message', handleMessage)
    socket.once('close', handleClose)
    socket.once('error', handleError)
  })
}

function waitForRejectedSocket(port: number, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { Origin: origin } })
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error('Timed out waiting for websocket rejection'))
    }, 1000)
    socket.once('close', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function createMockClientRequest() {
  const request = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn<(...args: any[]) => any>>
    end: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  }
  request.write = vi.fn(() => true)
  request.end = vi.fn(() => request)
  return request
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for condition')
}

describe('bounded capture secrecy and byte parity', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.mocked(net.fetch).mockReset()
  })
  afterEach(() => BaseService.resetInstances())
  it.each(['api_key', 'credentials', 'authorization'] as const)(
    'omits truncated JSON with early sensitive %s',
    (key) => {
      const original = JSON.stringify({ [key]: 'private-early-marker', prompt: 'x'.repeat(140000) })
      const captured = captureRequestBody(original, 'application/json')
      expect(captured).toMatchObject({ truncated: true })
      expect(captured?.text).toBeUndefined()
      expect(captured?.replayable).toBe(false)
    }
  )
  it('preserves direct binary BOM bytes', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('plain text')])
    const captured = captureRequestBody(bytes, 'text/plain')
    expect(Buffer.from(captured?.text ?? '', 'utf8')).toEqual(bytes)
  })
  it.each(['bom', 'invalid'] as const)('preserves or refuses cloned Request %s bytes', async (kind) => {
    vi.mocked(net.fetch).mockResolvedValue(new Response('ok', { headers: { 'content-type': 'text/plain' } }))
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchNetFetch: () => void }
    state.patchNetFetch()
    const bytes = kind === 'bom' ? Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]) : Uint8Array.from([0x80, 0xff, 0x41])
    const request = new Request('https://example.test/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: bytes
    })
    try {
      await net.fetch(request)
      await waitFor(() => state.events[0]?.requestBody !== undefined)
      const body = state.events[0].requestBody
      if (kind === 'bom') expect(Buffer.from(body?.text ?? '', 'utf8')).toEqual(Buffer.from(bytes))
      else {
        expect(body?.replayable).toBe(false)
        expect(body?.text).toBeUndefined()
      }
      expect(Buffer.from(await request.arrayBuffer())).toEqual(Buffer.from(bytes))
    } finally {
      await service._doStop()
    }
  })
})

it.skipIf(process.platform === 'win32')(
  'replays direct-byte and cloned-Request BOM captures byte-for-byte over local HTTP/cURL',
  async () => {
    const received: Buffer[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push(Buffer.concat(chunks))
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
    vm.createContext(sandbox)
    vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
    try {
      for (const mode of ['direct', 'request'] as const) {
        BaseService.resetInstances()
        const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x41])
        const service = new MainNetworkDevtoolsService()
        const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
        state.patchFetch()
        try {
          const response =
            mode === 'request'
              ? await fetch(
                  new Request(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: bytes })
                )
              : await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: bytes })
          await response.text()
          await waitFor(() => state.events[0]?.requestBody !== undefined)
          const event = state.events[0]
          expect(event.requestBody?.replayable).toBe(true)
          const command = sandbox.buildCurlCommand?.(event)
          expect(command).toBeDefined()
          await promisify(execFile)('/bin/sh', ['-c', command as string], { timeout: 5000 })
          expect(received.at(-1)).toEqual(bytes)
          expect(received.at(-2)).toEqual(bytes)
        } finally {
          await service._doStop()
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it('omits truncated JSON on Node writes and cloned Requests without consuming the original', async () => {
  const original = JSON.stringify({ api_key: 'private-truncation-marker', prompt: 'x'.repeat(140000) })
  BaseService.resetInstances()
  const nodeService = new MainNetworkDevtoolsService()
  const nodeState = nodeService as unknown as {
    events: MainNetworkDevtoolsEvent[]
    wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
  }
  const pending = createMockClientRequest()
  nodeState.wrapHttpMethod(() => pending, 'http')('http://example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' }
  })
  pending.end(original)
  await Promise.resolve()
  expect(nodeState.events[0].requestBody).toMatchObject({ truncated: true, replayable: false })
  expect(nodeState.events[0].requestBody?.text).toBeUndefined()
  await nodeService._doStop()
  BaseService.resetInstances()
  vi.mocked(net.fetch).mockResolvedValue(new Response('ok'))
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchNetFetch: () => void }
  state.patchNetFetch()
  const request = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: original
  })
  try {
    await net.fetch(request)
    await waitFor(() => state.events[0]?.requestBody !== undefined)
    expect(state.events[0].requestBody).toMatchObject({ truncated: true, replayable: false })
    expect(state.events[0].requestBody?.text).toBeUndefined()
    expect(await request.text()).toBe(original)
  } finally {
    await service._doStop()
  }
})

it.each(['application/json', 'text/plain', undefined])(
  'redacts small BOM JSON for string, Buffer and cloned Request (%s)',
  async (contentType) => {
    const original = '\uFEFF{"api_key":"private-bom-marker","prompt":"hi"}'
    for (const input of [original, Buffer.from(original)]) {
      const captured = captureRequestBody(input, contentType)
      expect(captured?.text).toBe('\uFEFF{"api_key":"<redacted>","prompt":"hi"}')
      expect(captured?.replayable).toBe(true)
    }
    BaseService.resetInstances()
    vi.mocked(net.fetch).mockResolvedValue(new Response('ok'))
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchNetFetch: () => void }
    state.patchNetFetch()
    const request = new Request('https://example.test/', {
      method: 'POST',
      headers: contentType ? { 'content-type': contentType } : undefined,
      body: Buffer.from(original)
    })
    try {
      await net.fetch(request)
      await waitFor(() => state.events[0]?.requestBody !== undefined)
      expect(state.events[0].requestBody?.text).toBe('\uFEFF{"api_key":"<redacted>","prompt":"hi"}')
      expect(await request.text()).toBe(original.slice(1))
    } finally {
      await service._doStop()
    }
  }
)
it('does not label truncated plain-text captures as replayable', () => {
  expect(captureRequestBody('€'.repeat(140000), 'text/plain')).toMatchObject({ truncated: true, replayable: false })
})
it('redacts sensitive fields in malformed JSON instead of returning raw credential text', () => {
  expect(captureRequestBody('{"api_key":"private-malformed-marker",', 'application/json')?.text).not.toContain(
    'private-malformed-marker'
  )
})

it.each(['A\0B', '\0', 'a\0\0z'])('does not label embedded-NUL text as shell replayable (%j)', (text) => {
  for (const body of [text, Buffer.from(text)]) {
    const captured = captureRequestBody(body, 'text/plain')
    expect(captured?.text).toBe(text)
    expect(captured?.replayable).toBe(false)
    expect(captured?.note).toContain('NUL')
  }
})

it('keeps JSON escaped NUL values replayable without adding literal NUL shell bytes', () => {
  const captured = captureRequestBody(JSON.stringify({ value: 'A\0B' }), 'application/json')
  expect(captured?.replayable).toBe(true)
  expect(captured?.text).toBe('{"value":"A\\u0000B"}')
  expect(captured?.text).not.toContain('\0')
})
it('marks streamed Node and cloned Request NUL captures as non-replayable', async () => {
  BaseService.resetInstances()
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as {
    events: MainNetworkDevtoolsEvent[]
    wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
    patchNetFetch: () => void
  }
  const request = createMockClientRequest()
  state.wrapHttpMethod(() => request, 'http')('http://example.test/', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' }
  })
  request.write('A')
  request.end(Buffer.from([0, 66]))
  await Promise.resolve()
  expect(state.events[0].requestBody).toMatchObject({ text: 'A\0B', replayable: false })
  vi.mocked(net.fetch).mockResolvedValue(new Response('ok'))
  state.patchNetFetch()
  try {
    await net.fetch(
      new Request('https://example.test/', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from([65, 0, 66])
      })
    )
    await waitFor(() => state.events.some((event) => event.source === 'net' && event.requestBody !== undefined))
    expect(state.events.find((event) => event.source === 'net')?.requestBody).toMatchObject({
      text: 'A\0B',
      replayable: false
    })
  } finally {
    await service._doStop()
  }
})

it.each(['secret', 'true-secret', 'null-secret', '123secret'])(
  'removes the complete malformed unquoted credential %s',
  (secret) => {
    const captured = captureRequestBody(`{"api_key":${secret},}`, 'application/json')
    expect(captured?.text).not.toContain(secret)
  }
)
it.each(['-0', '-0.0', '-0e2'])('does not normalize signed JSON zero %s into replayable positive zero', (zero) => {
  const captured = captureRequestBody(`{"amount":${zero}}`, 'application/json')
  expect(captured?.replayable).toBe(false)
  expect(captured?.text).toContain(zero)
})
it('preserves the complete Fetch URLSearchParams effective Content-Type', () => {
  const body = new URLSearchParams({ word: 'é' })
  expect(getEffectiveFetchRequestContentType(undefined, body)).toBe('application/x-www-form-urlencoded;charset=UTF-8')
  expect(captureRequestBody(body)?.contentType).toBe('application/x-www-form-urlencoded;charset=UTF-8')
})

it.skipIf(process.platform === 'win32')(
  'preserves headerless URLSearchParams Content-Type and bytes in actual Fetch/cURL replay',
  async () => {
    const received: { contentType: string | undefined; body: Buffer }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push({ contentType: req.headers['content-type'], body: Buffer.concat(chunks) })
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
    state.patchFetch()
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
      await (await fetch(url, { method: 'POST', body: new URLSearchParams({ word: 'é' }) })).text()
      const event = state.events[0]
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      const command = sandbox.buildCurlCommand?.(event)
      expect(command).toBeDefined()
      await promisify(execFile)('/bin/sh', ['-c', command as string], { timeout: 5000 })
      expect(received[0].contentType).toBe('application/x-www-form-urlencoded;charset=UTF-8')
      expect(received[1]).toEqual(received[0])
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it('handles Node flat raw-header arrays without interpreting numeric indices as header names', () => {
  expect(
    describeHttpRequest('http', [
      'http://example.test',
      { headers: ['Content-Type', 'text/plain', 'Authorization', 'Bearer private-marker'] }
    ]).requestHeaders
  ).toEqual({ 'Content-Type': 'text/plain', Authorization: '<redacted>' })
})
it('does not mark an exactly full Node JSON capture as truncated on empty decoder flush', async () => {
  const body = JSON.stringify({ prompt: 'x'.repeat(131072 - '{"prompt":""}'.length) })
  expect(body.length).toBe(131072)
  BaseService.resetInstances()
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as {
    events: MainNetworkDevtoolsEvent[]
    wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
  }
  const request = createMockClientRequest()
  state.wrapHttpMethod(() => request, 'http')('http://example.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  request.end(body)
  await Promise.resolve()
  expect(state.events[0].requestBody).toMatchObject({ text: body, replayable: true })
  expect(state.events[0].requestBody?.truncated).not.toBe(true)
  await service._doStop()
})
it('uses replacement Fetch init headers rather than restoring removed Request headers', async () => {
  BaseService.resetInstances()
  vi.mocked(net.fetch).mockResolvedValue(new Response('ok'))
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchNetFetch: () => void }
  state.patchNetFetch()
  try {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'X-Removed': 'old', 'Content-Type': 'application/json' },
      body: '{"ok":true}'
    })
    await net.fetch(request, { headers: { 'X-Kept': 'new' } })
    expect(state.events[0].requestHeaders).toEqual({ 'x-kept': 'new' })
  } finally {
    await service._doStop()
  }
})

it.skipIf(process.platform === 'win32')(
  'matches actual Fetch replacement headers and flat Node headers during replay',
  async () => {
    const received: { removed: string | undefined; kept: string | undefined; body: string }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push({
          removed: req.headers['x-removed'] as string | undefined,
          kept: req.headers['x-kept'] as string | undefined,
          body: Buffer.concat(chunks).toString()
        })
        res.statusCode = req.headers['x-removed'] ? 409 : 200
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      patchFetch: () => void
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    state.patchFetch()
    try {
      const request = new Request(url, { method: 'POST', headers: { 'X-Removed': 'old' }, body: 'hi' })
      const response = await fetch(request, { headers: { 'X-Kept': 'new' } })
      await response.text()
      expect(response.status).toBe(200)
      await waitFor(() => state.events[0]?.requestBody !== undefined)
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      await promisify(execFile)('/bin/sh', ['-c', sandbox.buildCurlCommand?.(state.events[0]) as string], {
        timeout: 5000
      })
      expect(received[1]).toEqual(received[0])
      const nodeRequest = state.wrapHttpMethod(httpRequest as (...args: unknown[]) => unknown, 'http')(url, {
        method: 'POST',
        headers: ['Host', new URL(url).host, 'X-Kept', 'flat', 'Content-Type', 'text/plain']
      })
      await new Promise<void>((resolve, reject) => {
        nodeRequest.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        nodeRequest.on('error', reject)
        nodeRequest.end('node')
      })
      expect(received.at(-1)).toEqual({ removed: undefined, kept: 'flat', body: 'node' })
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
it('still truncates a Node body with one character beyond the capture limit', async () => {
  BaseService.resetInstances()
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as {
    events: MainNetworkDevtoolsEvent[]
    wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
  }
  const request = createMockClientRequest()
  state.wrapHttpMethod(() => request, 'http')('http://example.test', { headers: { 'Content-Type': 'text/plain' } })
  request.write('x'.repeat(131072))
  request.end('y')
  await Promise.resolve()
  expect(state.events[0].requestBody).toMatchObject({ truncated: true, replayable: false, size: 131073 })
  await service._doStop()
})

it.each([131071, 131072, 131073])(
  'distinguishes a complete cloned Request JSON body of %i characters from overflow',
  async (length) => {
    const body = JSON.stringify({ prompt: 'x'.repeat(length - '{"prompt":""}'.length) })
    BaseService.resetInstances()
    vi.mocked(net.fetch).mockResolvedValue(new Response('ok'))
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchNetFetch: () => void }
    state.patchNetFetch()
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    })
    try {
      await net.fetch(request)
      await waitFor(() => state.events[0]?.requestBody !== undefined)
      if (length <= 131072) {
        expect(state.events[0].requestBody).toMatchObject({ text: body, replayable: true })
        expect(state.events[0].requestBody?.truncated).not.toBe(true)
      } else {
        expect(state.events[0].requestBody).toMatchObject({ truncated: true, replayable: false })
        expect(state.events[0].requestBody?.text).toBeUndefined()
      }
      expect(await request.text()).toBe(body)
    } finally {
      await service._doStop()
    }
  }
)

it.each(['text/plain', 'application/json'])(
  'redacts URLSearchParams independently of explicit %s metadata',
  (contentType) => {
    const captured = captureRequestBody(new URLSearchParams({ api_key: 'private-form-marker', word: 'é' }), contentType)
    expect(captured?.text).not.toContain('private-form-marker')
    expect(captured?.text).toContain('api_key=%3Credacted%3E')
    expect(captured?.contentType).toBe(contentType)
  }
)
it('preserves JSON own __proto__ keys at every depth while redacting nested secrets', () => {
  const body = '{"__proto__":{"role":"admin","api_key":"private-proto-marker"},"nested":[{"__proto__":{"x":1}}]}'
  const captured = captureRequestBody(body, 'application/json')
  const parsed = JSON.parse(captured?.text ?? '{}')
  expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
  expect(parsed.__proto__).toEqual({ role: 'admin', api_key: '<redacted>' })
  expect(Object.hasOwn(parsed.nested[0], '__proto__')).toBe(true)
  expect(captured?.replayable).toBe(true)
})

it.skipIf(process.platform === 'win32')(
  'preserves __proto__ payload keys and explicit form metadata during actual HTTP/cURL replay',
  async () => {
    const received: { contentType: string | undefined; body: string }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push({ contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString() })
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    state.patchFetch()
    const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
    vm.createContext(sandbox)
    vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
    try {
      const protoBody = '{"__proto__":{"role":"admin"},"nested":[{"__proto__":{"x":1}}]}'
      await (
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: protoBody })
      ).text()
      await promisify(execFile)('/bin/sh', ['-c', sandbox.buildCurlCommand?.(state.events[0]) as string], {
        timeout: 5000
      })
      expect(received[1]).toEqual(received[0])
      expect(received[1].body).toBe(protoBody)
      for (const contentType of ['text/plain', 'application/json']) {
        await (
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: new URLSearchParams({ api_key: 'private-form-network-marker', word: 'é' })
          })
        ).text()
        const event = state.events.at(-1) as MainNetworkDevtoolsEvent
        const command = sandbox.buildCurlCommand?.(event) as string
        expect(command).not.toContain('private-form-network-marker')
        await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 5000 })
        expect(received.at(-1)?.contentType).toBe(contentType)
        expect(received.at(-1)?.body).toBe('api_key=%3Credacted%3E&word=%C3%A9')
      }
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it('captures late-set Node header and effective body media type', async () => {
  BaseService.resetInstances()
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as {
    events: MainNetworkDevtoolsEvent[]
    wrapHttpMethod: (original: (...args: unknown[]) => unknown, source: 'http') => (...args: unknown[]) => unknown
  }
  const request = createMockClientRequest() as ReturnType<typeof createMockClientRequest> & {
    getHeaders: () => Record<string, string>
  }
  const headers: Record<string, string> = {}
  request.getHeaders = () => headers
  state.wrapHttpMethod(() => request, 'http')('http://example.test', { method: 'POST' })
  headers['content-type'] = 'application/json'
  request.end('{"api_key":"late-private-marker"}')
  await Promise.resolve()
  expect(state.events[0].requestHeaders).toMatchObject({ 'content-type': 'application/json' })
  expect(state.events[0].requestBody).toMatchObject({
    contentType: 'application/json',
    text: '{"api_key":"<redacted>"}'
  })
  await service._doStop()
})

it.skipIf(process.platform === 'win32').each(['late', 'empty', 'repeated', 'get', 'removed'] as const)(
  'preserves %s Node headers through actual HTTP/cURL replay',
  async (mode) => {
    const received: { raw: string[]; body: string }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push({ raw: req.rawHeaders, body: Buffer.concat(chunks).toString() })
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
    vm.createContext(sandbox)
    vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
    try {
      {
        BaseService.resetInstances()
        const service = new MainNetworkDevtoolsService()
        const state = service as unknown as {
          events: MainNetworkDevtoolsEvent[]
          wrapHttpMethod: (
            original: (...args: unknown[]) => unknown,
            source: 'http'
          ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
        }
        const headers =
          mode === 'repeated' || mode === 'get'
            ? ['Host', new URL(url).host, 'Content-Type', 'text/plain', 'X-Route', 'one', 'X-Route', 'two']
            : { 'Content-Type': mode === 'empty' ? '' : 'text/plain' }
        const request = state.wrapHttpMethod(
          (mode === 'get' ? httpGet : httpRequest) as (...args: unknown[]) => unknown,
          'http'
        )(url, {
          method: mode === 'get' ? 'GET' : 'POST',
          headers
        })
        if (mode === 'late') {
          request.setHeader('Content-Type', 'application/json')
          request.setHeader('X-Late', 'yes')
        }
        if (mode === 'removed') request.removeHeader('Content-Type')
        const body = mode === 'get' ? '' : mode === 'late' ? '{"ok":true}' : 'payload'
        await new Promise<void>((resolve, reject) => {
          request.on('response', (res) => {
            res.resume()
            res.on('end', resolve)
          })
          request.on('error', reject)
          if (mode !== 'get') request.end(body)
        })
        const event = state.events[0]
        const command = sandbox.buildCurlCommand?.(event) as string
        await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 5000 })
        const selected = (value: (typeof received)[number]) => ({
          headers: value.raw.flatMap((name, index) =>
            index % 2 === 0 && ['content-type', 'x-route', 'x-late'].includes(name.toLowerCase())
              ? [[name.toLowerCase(), value.raw[index + 1]]]
              : []
          ),
          body: value.body
        })
        expect(selected(received.at(-1) as (typeof received)[number])).toEqual(
          selected(received.at(-2) as (typeof received)[number])
        )
        if (mode === 'late') expect(event.requestBody?.contentType).toBe('application/json')
        if (mode === 'removed') expect(event.requestBody?.contentType).toBeUndefined()
        await service._doStop()
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it('reports prematurely terminated ASCII response as a transport error, not invalid UTF-8', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '999' })
    res.write('ASCII body')
    setTimeout(() => res.destroy(), 30)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  BaseService.resetInstances()
  const service = new MainNetworkDevtoolsService()
  const state = service as unknown as {
    events: MainNetworkDevtoolsEvent[]
    captureFetchResponseBody: (id: string, response: Response) => void
  }
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`)
    state.events.push({
      id: 'transport',
      source: 'fetch',
      state: 'success',
      url: 'http://test',
      method: 'GET',
      startedAt: Date.now()
    })
    state.captureFetchResponseBody('transport', response)
    await response.text().catch(() => {})
    await vi.waitFor(() => expect(state.events[0].responseBodyError).toMatch(/terminated/))
    expect(state.events[0].responseBody).toBeUndefined()
  } finally {
    await service._doStop()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it
  .skipIf(process.platform === 'win32')
  .each([undefined, '', 'text/plain', 'application/json', 'application/octet-stream'])(
  'redacts retained Request form bytes with replacement Content-Type %s without restoring removed headers',
  async (replacementType) => {
    const received: { type: string | undefined; body: string }[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push({ type: req.headers['content-type'], body: Buffer.concat(chunks).toString() })
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
    vm.createContext(sandbox)
    vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
    state.patchFetch()
    try {
      const body = new URLSearchParams({ api_key: 'retained-form-private-marker', word: 'é' })
      const request = new Request(url, { method: 'POST', body })
      const headers: Record<string, string> = replacementType !== undefined ? { 'Content-Type': replacementType } : {}
      await (await fetch(request, { headers })).text()
      await waitFor(() => state.events[0]?.requestBody?.text !== undefined)
      const event = state.events[0]
      expect(event.requestBody?.text).toBe('api_key=%3Credacted%3E&word=%C3%A9')
      expect(event.requestBody?.contentType).toBe(replacementType)
      const command = sandbox.buildCurlCommand?.(event) as string
      expect(JSON.stringify(event)).not.toContain('retained-form-private-marker')
      expect(command).not.toContain('retained-form-private-marker')
      await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 5000 })
      expect(received[0]).toEqual({ type: replacementType, body: body.toString() })
      expect(received[1]).toEqual({ type: replacementType, body: 'api_key=%3Credacted%3E&word=%C3%A9' })
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32').each(['file', 'node', 'async'] as const)(
  'does not stringify or consume %s streaming uploads or export invented bytes',
  async (kind) => {
    const received: string[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString())
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const dir = mkdtempSync(join(tmpdir(), 'network-stream-'))
    const file = join(dir, 'upload.txt')
    const bytes = 'actual-upload-bytes-é'
    writeFileSync(file, bytes)
    let pulls = 0
    const body =
      kind === 'file'
        ? createReadStream(file)
        : kind === 'node'
          ? Readable.from([bytes])
          : {
              async *[Symbol.asyncIterator]() {
                pulls++
                yield Buffer.from(bytes)
              }
            }
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
    const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
    vm.createContext(sandbox)
    vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
    try {
      const capture = captureRequestBody(body, 'text/plain')
      expect(pulls).toBe(0)
      if (body instanceof Readable) {
        expect(body.readableFlowing).toBeNull()
        expect(body.readableLength).toBe(0)
      }
      state.patchFetch()
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        duplex: 'half'
      } as unknown as RequestInit
      await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`, init)).text()
      expect(received[0]).toBe(bytes)
      if (kind === 'async') expect(pulls).toBe(1)
      const command = sandbox.buildCurlCommand?.(state.events[0]) as string
      await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 5000 })
      expect(received[1]).toBe('')
      expect(command).not.toContain('--data-raw')
      expect(command).not.toContain('[object Object]')
      expect(capture).toMatchObject({ replayable: false, note: 'Streaming request body is not captured.' })
      expect(capture?.text).toBeUndefined()
    } finally {
      if (body instanceof Readable) body.destroy()
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

it.skipIf(process.platform === 'win32').each([undefined, 'text/plain', 'application/json'])(
  'omits retained multipart bytes despite replacement type %s',
  async (type) => {
    const received: string[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString())
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as { events: MainNetworkDevtoolsEvent[]; patchFetch: () => void }
    state.patchFetch()
    try {
      const form = new FormData()
      form.set('api_key', 'multipart-private-marker')
      const request = new Request(`http://127.0.0.1:${(server.address() as { port: number }).port}/`, {
        method: 'POST',
        body: form
      })
      const headers: Record<string, string> = type ? { 'Content-Type': type } : {}
      await (await fetch(request, { headers })).text()
      await waitFor(() => state.events[0]?.requestBody !== undefined)
      expect(received[0]).toContain('multipart-private-marker')
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      const event = state.events[0]
      expect(JSON.stringify(event)).not.toContain('multipart-private-marker')
      expect(event.requestBody?.text).toBeUndefined()
      expect(sandbox.buildCurlCommand?.(event)).not.toContain('--data-raw')
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32').each(['/a/../b', '/a/./b', '/%2e%2e/b'])(
  'exports a complete warned command for normalized Node path %s',
  async (path) => {
    const received: string[] = []
    const server = createServer((req, res) => {
      received.push(req.url ?? '')
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    try {
      const request = state.wrapHttpMethod(
        httpRequest as (...args: unknown[]) => unknown,
        'http'
      )({ hostname: '127.0.0.1', port: (server.address() as { port: number }).port, path })
      await new Promise<void>((resolve, reject) => {
        request.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
        request.end()
      })
      expect(received).toEqual([path])
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      const command = sandbox.buildCurlCommand?.(state.events[0]) as string
      await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 5000 })
      expect(received).toEqual([path, new URL(state.events[0].url).pathname])
      expect(command).toContain('# URL path may be normalized;')
      expect(command).toContain('\ncurl ')
      expect(state.events[0].requestReplayError).toBeUndefined()
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32').each(['/a#fragment', 'http://example.invalid/target'])(
  'keeps an editable command for a special Node target: %s',
  async (path) => {
    const received: string[] = []
    const server = createServer((req, res) => {
      received.push(req.url ?? '')
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    try {
      const request = state.wrapHttpMethod(
        httpRequest as (...args: unknown[]) => unknown,
        'http'
      )({ hostname: '127.0.0.1', port: (server.address() as { port: number }).port, path })
      await new Promise<void>((resolve, reject) => {
        request.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
        request.end()
      })
      expect(received).toEqual([path])
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      const command = sandbox.buildCurlCommand?.(state.events[0]) as string
      // Special targets are editable starting points, not faithful replay promises.
      expect(received).toEqual([path])
      expect(state.events[0].requestReplayError).toBeDefined()
      expect(command.startsWith('#')).toBe(true)
      expect(command).toContain('curl ')
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32')(
  'uses Node URL/options port precedence for actual replay destination',
  async () => {
    const received: string[] = []
    const servers = ['A', 'B'].map((name) =>
      createServer((req, res) => {
        req.resume()
        req.on('end', () => {
          received.push(name)
          res.end('ok')
        })
      })
    )
    for (const server of servers) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    try {
      const portA = (servers[0].address() as { port: number }).port
      const portB = (servers[1].address() as { port: number }).port
      const request = state.wrapHttpMethod(httpRequest as (...args: unknown[]) => unknown, 'http')(
        `http://127.0.0.1:${portA}/`,
        { port: portB }
      )
      await new Promise<void>((resolve, reject) => {
        request.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
        request.end()
      })
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      await promisify(execFile)('/bin/sh', ['-c', sandbox.buildCurlCommand?.(state.events[0]) as string], {
        timeout: 5000
      })
      expect(received).toEqual(['B', 'B'])
      expect(new URL(state.events[0].url).port).toBe(String(portB))
    } finally {
      await service._doStop()
      for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32')(
  'preserves verified zero-length framing for empty Node POST replay',
  async () => {
    const received: (string | undefined)[] = []
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        received.push(req.headers['content-length'])
        res.statusCode = req.headers['content-length'] === '0' ? 200 : 411
        res.end('ok')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    try {
      const request = state.wrapHttpMethod(httpRequest as (...args: unknown[]) => unknown, 'http')(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
        { method: 'POST' }
      )
      await new Promise<void>((resolve, reject) => {
        request.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
        request.end()
      })
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      await promisify(execFile)('/bin/sh', ['-c', sandbox.buildCurlCommand?.(state.events[0]) as string], {
        timeout: 5000
      })
      expect(received).toEqual(['0', '0'])
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.skipIf(process.platform === 'win32')(
  'replays port-only Node requests against their default localhost destination',
  async () => {
    const received: string[] = []
    const server = createServer((req, res) => {
      received.push(req.url ?? '')
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    BaseService.resetInstances()
    const service = new MainNetworkDevtoolsService()
    const state = service as unknown as {
      events: MainNetworkDevtoolsEvent[]
      wrapHttpMethod: (
        original: (...args: unknown[]) => unknown,
        source: 'http'
      ) => (...args: unknown[]) => ReturnType<typeof httpRequest>
    }
    try {
      const request = state.wrapHttpMethod(
        httpRequest as (...args: unknown[]) => unknown,
        'http'
      )({ port: (server.address() as { port: number }).port, path: '/v1/chat' })
      await new Promise<void>((resolve, reject) => {
        request.on('response', (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
        request.end()
      })
      const event = state.events[0]
      expect(new URL(event.url).hostname).toBe('localhost')
      const sandbox: { buildCurlCommand?: (event: MainNetworkDevtoolsEvent) => string } = {}
      vm.createContext(sandbox)
      vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
      await promisify(execFile)('/bin/sh', ['-c', sandbox.buildCurlCommand?.(event) as string], { timeout: 5000 })
      expect(received).toEqual(['/v1/chat', '/v1/chat'])
    } finally {
      await service._doStop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

it.each([
  { socketPath: '/tmp/private-network-socket', path: '/' },
  { auth: 'private-user:private-password', hostname: 'localhost', path: '/' }
])('exports an editable command for Node-only connection options without retaining private details', (options) => {
  const description = describeHttpRequest('http', [options]) as ReturnType<typeof describeHttpRequest> & {
    requestReplayError?: string
  }
  expect(description.requestReplayError).toBeDefined()
  expect(JSON.stringify(description)).not.toContain('private-')
  const sandbox: { buildCurlCommand?: (event: unknown) => string } = {}
  vm.createContext(sandbox)
  vm.runInContext(readFileSync('resources/devtools/main-network/curlExport.js', 'utf8'), sandbox)
  const command = sandbox.buildCurlCommand?.(description) as string
  expect(command.startsWith('#')).toBe(true)
  expect(command).toContain('curl ')
})

it('keeps URL userinfo redacted for editable export', () => {
  const description = describeHttpRequest('http', ['http://private-user:private-password@localhost/']) as ReturnType<
    typeof describeHttpRequest
  > & { requestReplayError?: string }
  expect(description.requestReplayError).toBeDefined()
  expect(JSON.stringify(description)).not.toContain('private-')
})

it('matches numeric zero default-port semantics without changing literal string zero', () => {
  expect(new URL(describeHttpRequest('http', [{ port: 0 }]).url).port).toBe('')
  expect(new URL(describeHttpRequest('http', [{ port: '0' }]).url).port).toBe('0')
})
