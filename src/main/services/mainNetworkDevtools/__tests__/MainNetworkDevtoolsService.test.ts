import { once } from 'node:events'
import { type ClientRequest, createServer, type IncomingMessage, request as createHttpRequest } from 'node:http'

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
    service['patchNetFetch']()

    try {
      expect(net.fetch).not.toBe(originalNetFetch)
      const result = await net.fetch('https://api.test/v1/chat?token=secret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"token":"secret","message":"hello"}'
      })

      await expect(result.text()).resolves.toBe('{"ok":true}')
      await waitFor(() => service['events'][0]?.responseBody !== undefined)

      expect(service['events'][0]?.requestBody?.text).toBe('{"token":"<redacted>","message":"hello"}')
      expect(service['events'][0]?.responseBody?.text).toBe('{"ok":true}')
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
    service['patchNetFetch']()

    try {
      const result = await net.fetch('https://api.test/download')
      await waitFor(() => service['events'][0]?.responseBody !== undefined)

      // Skipping the clone means the body is never teed, so no unread branch can buffer.
      expect(cloneSpy).not.toHaveBeenCalled()
      expect(service['events'][0]?.responseBody).toMatchObject({
        contentType: 'application/octet-stream',
        note: expect.any(String)
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
    service['patchNetFetch']()

    try {
      await expect(net.fetch('https://api.test/v1/chat')).resolves.toBe(response)
      expect(service['events'][0]).toMatchObject({
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
    expect(captureRequestBody('{"api_key":"secret","prompt":"hi"}', 'application/json')?.text).toBe(
      '{"api_key":"<redacted>","prompt":"hi"}'
    )
    expect(captureRequestBody(new URLSearchParams({ token: 'secret', query: 'hello' }))?.text).toBe(
      'token=%3Credacted%3E&query=hello'
    )
  })

  it('allows only registered DevTools extension origins', () => {
    const service = new MainNetworkDevtoolsService()

    expect(service['isOriginAllowed'](undefined)).toBe(false)
    expect(service['isOriginAllowed']('http://localhost:3000')).toBe(false)

    service['registerOrigin']('chrome-extension://main-network-id')

    expect(service['isOriginAllowed']('chrome-extension://main-network-id')).toBe(true)
    expect(service['isOriginAllowed']('chrome-extension://other-id')).toBe(false)
  })

  it('installs its own bundled panel once the app is ready and allowlists the resolved extension origin', async () => {
    vi.mocked(installBundledDevtools).mockImplementation(async (_directoryName, _displayName, onInstalled) => {
      onInstalled?.({ id: 'main-network-id', name: 'Main Network' })
    })

    const service = new MainNetworkDevtoolsService()
    // Panel install must hang off onAllReady, not onInit: this service runs in the
    // Background phase, which starts before app.whenReady() resolves.
    await service._doAllReady()
    expect(service['isOriginAllowed']('chrome-extension://main-network-id')).toBe(true)
  })

  it('enforces the registered DevTools extension origin on live websocket connections', async () => {
    const service = new MainNetworkDevtoolsService()
    service['registerOrigin']('chrome-extension://main-network-id')
    const port = await service['startWebSocketServer'](0)

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

  it('forwards native Node requests without consuming their responses', async () => {
    const service = new MainNetworkDevtoolsService()
    const server = createServer(async (incoming, outgoing) => {
      incoming.setEncoding('utf8')
      let body = ''
      for await (const chunk of incoming) body += chunk
      outgoing.writeHead(200, { 'content-type': 'text/plain' })
      outgoing.end(`received:${body}`)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    let client: ClientRequest | undefined
    let response: IncomingMessage | undefined

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a local HTTP listener')
      const url = `http://127.0.0.1:${address.port}/`
      const options = { method: 'POST', headers: { 'content-type': 'text/plain' } }
      const originalRequest = createHttpRequest(url, options)
      client = originalRequest
      const wrappedRequest = service['wrapHttpMethod'](() => originalRequest, 'http')
      const request = wrappedRequest(url, options)
      expect(request).toBe(client)
      const responseReady = new Promise<IncomingMessage>((resolve, reject) => {
        request.once('response', resolve)
        request.once('error', reject)
      })
      const writeDone = vi.fn()
      const endDone = vi.fn()
      expect(request.write('part-', 'utf8', writeDone)).toBe(true)
      expect(request.end('body', 'utf8', endDone)).toBe(request)
      response = await responseReady

      expect(response.listenerCount('data')).toBe(0)
      expect(service['events'][0]).toMatchObject({
        state: 'success',
        status: 200,
        requestBody: { text: 'part-body' },
        responseBody: { contentType: 'text/plain', note: expect.any(String) }
      })
      response.setEncoding('utf8')
      let body = ''
      for await (const chunk of response) body += chunk
      expect(body).toBe('received:part-body')
      expect(writeDone).toHaveBeenCalledTimes(1)
      expect(endDone).toHaveBeenCalledTimes(1)
    } finally {
      response?.destroy()
      client?.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await service._doStop()
    }
  })

  it('marks Node http events as error when request creation throws synchronously', () => {
    const service = new MainNetworkDevtoolsService()
    const wrappedRequest = service['wrapHttpMethod'](() => {
      throw new Error('invalid request')
    }, 'https')

    expect(() => wrappedRequest('https://example.test')).toThrow('invalid request')
    expect(service['events'][0]).toMatchObject({
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for condition')
}
