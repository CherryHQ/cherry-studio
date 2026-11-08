import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import * as Lark from '@larksuiteoapi/node-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() }
function channel(httpInstance: any) {
  return Lark.createLarkChannel({
    appId: 'cli_0123456789abcdef',
    appSecret: 'test',
    transport: 'websocket',
    httpInstance,
    logger
  })
}

afterEach(() => vi.useRealTimers())

describe('locked Feishu SDK disposal', () => {
  it('clears safety sweepers even when bot identity discovery fails', async () => {
    vi.useFakeTimers()
    const baseline = vi.getTimerCount()
    const sdk = channel({ request: vi.fn().mockRejectedValue(new Error('offline')) })
    expect(vi.getTimerCount()).toBe(baseline + 2)
    await expect(sdk.connect()).rejects.toThrow()
    await sdk.disconnect()
    expect(vi.getTimerCount()).toBe(baseline)
    await sdk.disconnect()
    expect(vi.getTimerCount()).toBe(baseline)
  })

  it('does not start a transport when closed during bot identity discovery', async () => {
    vi.useFakeTimers()
    let resolveIdentity!: (value: any) => void
    const request = vi.fn()
    const sdk = channel({ request })
    vi.spyOn(sdk.rawClient, 'request').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIdentity = resolve
        })
    )
    const connecting = sdk.connect()
    await Promise.resolve()
    await sdk.disconnect()
    resolveIdentity({ bot: { open_id: 'ou_bot' } })
    await connecting
    expect(sdk.rawWsClient).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not open a socket when closed during endpoint discovery', async () => {
    vi.useFakeTimers()
    let resolveEndpoint!: (value: unknown) => void
    const request = vi.fn((config: any) => {
      if (config.url.includes('callback/ws/endpoint'))
        return new Promise((resolve) => {
          resolveEndpoint = resolve
        })
      if (config.url.includes('tenant_access_token'))
        return Promise.resolve({ code: 0, tenant_access_token: 'test', expire: 7200 })
      if (config.url.includes('bot/v3/info'))
        return Promise.resolve({ code: 0, bot: { open_id: 'ou_bot', app_name: 'test' } })
      throw new Error(`Unexpected SDK request: ${config.url}`)
    })
    const sdk = channel({ request })
    vi.spyOn(sdk.rawClient, 'request').mockResolvedValue({ bot: { open_id: 'ou_bot', app_name: 'test' } })
    const reconnected = vi.fn()
    sdk.on('reconnected', reconnected)
    const connecting = sdk.connect().catch(() => undefined)
    // Reach the actual SDK endpoint discovery without advancing its 15s watchdog.
    for (let i = 0; i < 100 && !resolveEndpoint; i++) await Promise.resolve()
    expect(resolveEndpoint).toBeTypeOf('function')
    const ws = sdk.rawWsClient!
    const connect = vi.spyOn(ws as any, 'connect')
    await sdk.disconnect()
    resolveEndpoint({
      code: 0,
      data: {
        URL: 'ws://127.0.0.1:1/test',
        ClientConfig: { PingInterval: 1, ReconnectInterval: 1, ReconnectNonce: 0, ReconnectCount: -1 }
      }
    })
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(connect).not.toHaveBeenCalled()
    expect(reconnected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15000)
    await connecting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still completes a real local WebSocket handshake and cleans up on disconnect', async () => {
    vi.useFakeTimers()
    const server = createServer()
    const sockets = new Set<Socket>()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    server.on('upgrade', (req, socket) => {
      const accept = createHash('sha1')
        .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64')
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const sdk = channel({
      request: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          URL: `ws://127.0.0.1:${address.port}/?device_id=test&service_id=1`,
          ClientConfig: { PingInterval: 60, ReconnectInterval: 60, ReconnectNonce: 0, ReconnectCount: -1 }
        }
      })
    })
    vi.spyOn(sdk.rawClient, 'request').mockResolvedValue({ bot: { open_id: 'ou_bot' } })
    try {
      await sdk.connect()
      expect(sdk.rawWsClient?.getConnectionStatus()).toMatchObject({ state: 'connected' })
      sdk.rawWsClient?.close({ force: true })
      await sdk.disconnect()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      sdk.rawWsClient?.close({ force: true })
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('cancels a real pending WebSocket before the upgrade response', async () => {
    vi.useFakeTimers()
    const server = createServer()
    const sockets = new Set<Socket>()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    let gotUpgrade!: () => void
    const upgrading = new Promise<void>((resolve) => {
      gotUpgrade = resolve
    })
    server.on('upgrade', () => gotUpgrade())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const sdk = channel({
      request: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          URL: `ws://127.0.0.1:${address.port}/?device_id=test&service_id=1`,
          ClientConfig: { PingInterval: 60, ReconnectInterval: 60, ReconnectNonce: 0, ReconnectCount: -1 }
        }
      })
    })
    vi.spyOn(sdk.rawClient, 'request').mockResolvedValue({ bot: { open_id: 'ou_bot' } })
    const reconnecting = vi.fn()
    sdk.on('reconnecting', reconnecting)
    const connecting = sdk.connect().catch(() => undefined)
    try {
      await upgrading
      sdk.rawWsClient?.close({ force: true })
      await sdk.disconnect()
      // Channel's existing handshake watchdog is bounded to 15s, even after retirement.
      await vi.advanceTimersByTimeAsync(15000)
      await connecting
      expect(reconnecting).not.toHaveBeenCalled()
      expect(sdk.rawWsClient?.getConnectionStatus()).not.toMatchObject({ state: 'connected' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      sdk.rawWsClient?.close({ force: true })
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
