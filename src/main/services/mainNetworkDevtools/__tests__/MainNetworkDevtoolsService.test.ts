import { EventEmitter } from 'node:events'

import { BaseService } from '@main/core/lifecycle'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

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
  clearMainNetworkDevtoolsOrigins,
  isMainNetworkDevtoolsOriginAllowed,
  registerMainNetworkDevtoolsOrigin
} from '../mainNetworkDevtoolsAccess'
import {
  captureRequestBody,
  describeHttpRequest,
  getMainNetworkDevtoolsPort,
  type MainNetworkDevtoolsEvent,
  MainNetworkDevtoolsService,
  redactHeaders,
  redactUrl
} from '../MainNetworkDevtoolsService'

describe('MainNetworkDevtoolsService helpers', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    clearMainNetworkDevtoolsOrigins()
    vi.mocked(net.fetch).mockReset()
  })

  afterEach(() => {
    BaseService.resetInstances()
    clearMainNetworkDevtoolsOrigins()
  })

  it('redacts sensitive URL credentials and query params', () => {
    expect(redactUrl('https://user:pass@example.com/v1/chat?api_key=secret&model=test&token=abc')).toBe(
      'https://%5Bredacted%5D:%5Bredacted%5D@example.com/v1/chat?api_key=%5Bredacted%5D&model=test&token=%5Bredacted%5D'
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
      Authorization: '[redacted]',
      Cookie: '[redacted]',
      'X-Trace-Id': 'trace-id',
      'X-Api-Token': '[redacted]'
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
      url: 'https://example.com/v1/chat?token=%5Bredacted%5D',
      requestHeaders: {
        Authorization: '[redacted]',
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

      expect(serviceState.events[0]?.requestBody?.text).toBe('{"token":"[redacted]","message":"hello"}')
      expect(serviceState.events[0]?.responseBody?.text).toBe('{"ok":true}')
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
    expect(captureRequestBody('{"api_key":"secret","prompt":"hi"}', 'application/json')?.text).toBe(
      '{"api_key":"[redacted]","prompt":"hi"}'
    )
    expect(captureRequestBody(new URLSearchParams({ token: 'secret', query: 'hello' }))?.text).toBe(
      'token=%5Bredacted%5D&query=hello'
    )
  })

  it('allows only registered DevTools extension origins', () => {
    expect(isMainNetworkDevtoolsOriginAllowed(undefined)).toBe(false)
    expect(isMainNetworkDevtoolsOriginAllowed('http://localhost:3000')).toBe(false)

    registerMainNetworkDevtoolsOrigin('chrome-extension://main-network-id')

    expect(isMainNetworkDevtoolsOriginAllowed('chrome-extension://main-network-id')).toBe(true)
    expect(isMainNetworkDevtoolsOriginAllowed('chrome-extension://other-id')).toBe(false)
  })

  it('installs its own bundled panel and allowlists the resolved extension origin', async () => {
    vi.mocked(installBundledDevtools).mockImplementation(async (_directoryName, _displayName, onInstalled) => {
      onInstalled?.({ id: 'main-network-id', name: 'Main Network' })
    })

    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as { installPanel: () => Promise<void> }
    await serviceState.installPanel()

    expect(installBundledDevtools).toHaveBeenCalledWith('main-network', 'Main Network', expect.any(Function))
    expect(isMainNetworkDevtoolsOriginAllowed('chrome-extension://main-network-id')).toBe(true)
  })

  it('enforces the registered DevTools extension origin on live websocket connections', async () => {
    registerMainNetworkDevtoolsOrigin('chrome-extension://main-network-id')

    const service = new MainNetworkDevtoolsService()
    const serviceState = service as unknown as {
      startWebSocketServer: (port?: number) => Promise<number>
    }
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

  it('uses the fixed websocket port shared by the DevTools panel', () => {
    expect(getMainNetworkDevtoolsPort()).toBe(38997)
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
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
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
