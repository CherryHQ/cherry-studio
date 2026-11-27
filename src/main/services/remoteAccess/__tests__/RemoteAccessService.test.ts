import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { remoteLimits } from '@cherrystudio/remote-protocol'
import { createDeviceIdentity } from '@cherrystudio/remote-transport'
import type * as RemoteTransport from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { BaseService } from '@main/core/lifecycle'

const transport = vi.hoisted(() => ({ accept: vi.fn(), identity: new Uint8Array() as Uint8Array }))
vi.mock('@cherrystudio/remote-transport', async (original) => ({
  ...(await original<typeof RemoteTransport>()),
  acceptSecureChannel: transport.accept,
  RemoteSocketStream: class {}
}))
vi.mock('../deviceIdentity', () => ({ loadDesktopIdentity: async () => transport.identity }))

import { RemoteAccessService } from '../RemoteAccessService'
import { RemoteConnection } from '../RemoteConnection'

class Channel {
  constructor(private readonly socket: Socket) {}
  readonly remoteIdentity = 'phone'
  readonly protocolVersion = 1
  readonly offeredVersions = [1]
  readonly writes: any[] = []
  private pending?: { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  private queue: unknown[] = []
  read(signal?: AbortSignal): Promise<unknown> {
    if (this.queue.length) return Promise.resolve(this.queue.shift())
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
  push(value: unknown) {
    this.socket.message()
    if (this.pending) {
      const pending = this.pending
      this.pending = undefined
      pending.resolve(value)
    } else this.queue.push(value)
  }
  fail(error: Error) {
    this.pending?.reject(error)
    this.pending = undefined
  }
  async write(value: unknown) {
    this.writes.push(value)
  }
  async close() {}
  abort() {}
}

class Socket {
  binaryType = ''
  bufferedAmount = 0
  readyState = 1
  close = vi.fn()
  private listeners = new Map<string, Array<(event: { data: unknown }) => void>>()
  send() {}
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener)
    )
  }
  message() {
    this.listeners.get('message')?.forEach((listener) => listener({ data: new Uint8Array([1]) }))
  }
  closed() {
    this.listeners.get('close')?.forEach((listener) => listener({ data: undefined }))
  }
}

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

describe('remote access receive idle', () => {
  setupTestDatabase()
  let service: RemoteAccessService
  let deviceId: string
  let sequence: number
  beforeEach(async () => {
    transport.identity = await createDeviceIdentity()
    vi.useFakeTimers()
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.api_gateway.enabled': true,
      'feature.api_gateway.host': '0.0.0.0'
    })
    mockMainLoggerService.warn.mockClear()
    service = new RemoteAccessService()
    deviceId = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['agent']
    }).device.id
    sequence = 0
  })
  afterEach(() => {
    service.closeIngress()
    vi.restoreAllMocks()
    vi.useRealTimers()
    BaseService.resetInstances()
  })
  async function connect(authenticate = true) {
    const socket = new Socket()
    const channel = new Channel(socket)
    transport.accept.mockResolvedValueOnce(channel)
    service.accept(socket, '192.0.2.1')
    await flush()
    await request(channel, 'connection.hello', { protocolVersions: [1] })
    if (authenticate) await request(channel, 'connection.authenticate', { deviceId })
    return { socket, channel }
  }
  async function request(channel: Channel, method: string, params: unknown) {
    const id = String(++sequence)
    channel.push({ jsonrpc: '2.0', id, method, params })
    await flush()
    return channel.writes.find((value) => value.id === id)
  }
  async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms)
    await flush()
  }
  function warnings(message: string) {
    return mockMainLoggerService.warn.mock.calls.filter(([value]) => value === message)
  }

  it('releases silent peers before closing, even when the socket never closes', async () => {
    const dispose = vi.spyOn(RemoteConnection.prototype, 'dispose')
    const peers = await Promise.all([connect(), connect(), connect(), connect()])
    const { socket } = peers[0]
    await advance(59000)
    for (const peer of peers.slice(1)) await request(peer.channel, 'connection.ping', { nonce: 'n' })
    await advance(1000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
    expect(dispose).toHaveBeenCalledTimes(1)
    const replacement = await connect()
    expect(replacement.socket.close).not.toHaveBeenCalled()
    socket.closed()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(await request(replacement.channel, 'connection.ping', { nonce: 'alive' })).toMatchObject({
      result: { nonce: 'alive' }
    })
    expect(warnings('Remote peer idle timeout')).toHaveLength(1)
    expect(warnings('Remote session ended with an error')).toHaveLength(0)
  })

  it('keeps heartbeating sessions usable and still enforces per-address admission', async () => {
    const peers = await Promise.all([connect(), connect(), connect(), connect()])
    for (let i = 0; i < 4; i++) {
      await advance(20000)
      for (const peer of peers)
        expect(await request(peer.channel, 'connection.ping', { nonce: 'n' })).toMatchObject({ result: { nonce: 'n' } })
    }
    const fifth = new Socket()
    service.accept(fifth, '192.0.2.1')
    expect(fifth.close).toHaveBeenCalledExactlyOnceWith(1013, 'Too many remote connections')
    for (const peer of peers) expect(peer.socket.close).not.toHaveBeenCalled()
  })

  it.each(['rpc', 'upload', 'refused'])('%s decoded traffic postpones reaping', async (kind) => {
    const { socket, channel } = await connect()
    await advance(59000)
    if (kind === 'rpc') expect(await request(channel, 'connection.refresh', {})).toMatchObject({ result: { deviceId } })
    if (kind === 'upload') {
      channel.push({
        kind: 'upload',
        requestId: 'r',
        uploadId: 'u',
        writerEpoch: '1',
        offset: '0',
        bytes: new Uint8Array([1])
      })
      await flush()
    }
    if (kind === 'refused') {
      for (let i = 0; i < 256; i++) await request(channel, 'connection.ping', { nonce: 'n' })
      await advance(900)
      expect(await request(channel, 'connection.ping', { nonce: 'n' })).toMatchObject({
        error: { data: { reason: 'RATE_LIMITED' } }
      })
      await advance(59100)
      expect(socket.close).not.toHaveBeenCalled()
      await advance(1000)
      expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
      return
    }
    await advance(2000)
    expect(socket.close).not.toHaveBeenCalled()
    expect(await request(channel, 'connection.ping', { nonce: 'ok' })).toMatchObject({ result: { nonce: 'ok' } })
    await advance(61000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('keeps an incomplete record alive while frames arrive, then reaps it after silence', async () => {
    const { socket } = await connect()
    for (let i = 0; i < 4; i++) {
      await advance(20000)
      socket.message()
      expect(socket.close).not.toHaveBeenCalled()
    }
    await advance(59000)
    expect(socket.close).not.toHaveBeenCalled()
    await advance(2000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('counts frames while a rate-limit refusal write is blocked', async () => {
    const { socket, channel } = await connect()
    for (let i = 0; i < 256; i++) await request(channel, 'connection.ping', { nonce: 'n' })
    const write = vi.spyOn(channel, 'write').mockImplementation(() => new Promise(() => {}))
    channel.push({ jsonrpc: '2.0', id: 'blocked', method: 'connection.ping', params: { nonce: 'n' } })
    await flush()
    expect(write).toHaveBeenCalledOnce()
    for (let i = 0; i < 4; i++) {
      await advance(20000)
      socket.message()
      expect(socket.close).not.toHaveBeenCalled()
    }
    await advance(61000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('expires the token despite continued heartbeats', async () => {
    const { socket, channel } = await connect()
    for (let elapsed = 0; elapsed < remoteLimits.tokenMs + remoteLimits.refreshGraceMs; elapsed += 10000) {
      await advance(10000)
      if (elapsed + 10000 < remoteLimits.tokenMs + remoteLimits.refreshGraceMs)
        channel.push({ jsonrpc: '2.0', method: 'connection.ping', params: { nonce: 'n' } })
    }
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008, 'Remote session expired')
  })

  it('does not extend the idle window when an authentication batch finishes late', async () => {
    const { socket, channel } = await connect(false)
    let finish!: (value: Awaited<ReturnType<RemoteAccessService['getConnectionEndpoints']>>) => void
    vi.spyOn(service, 'getConnectionEndpoints').mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    channel.push([
      { jsonrpc: '2.0', id: 'auth', method: 'connection.authenticate', params: { deviceId } },
      { jsonrpc: '2.0', id: 'endpoints', method: 'connection.endpoints', params: { domain: 'agent' } }
    ])
    await flush()
    expect(finish).toBeTypeOf('function')
    await advance(59000)
    finish({ desktopIdentity: 'desktop', endpoints: [] })
    await flush()
    expect(channel.writes.some((value) => Array.isArray(value) && value.some((item) => item.id === 'auth'))).toBe(true)
    await advance(2000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('starts a fresh idle window when an old unauthenticated session authenticates', async () => {
    const { socket, channel } = await connect(false)
    await advance(70000)
    expect(socket.close).not.toHaveBeenCalled()
    expect(await request(channel, 'connection.authenticate', { deviceId })).toMatchObject({ result: { deviceId } })
    await advance(59000)
    expect(socket.close).not.toHaveBeenCalled()
    await advance(1000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('starts a fresh idle window after an approved pairing.get', async () => {
    const invitation = await service.createInvitation()
    const { socket, channel } = await connect(false)
    const claim = await request(channel, 'pairing.claim', {
      invitationId: invitation.invitationId,
      invitationSecret: invitation.invitationSecret,
      deviceName: 'Phone',
      platform: 'ios',
      capabilities: ['agent']
    })
    const claimId = claim.result.claimId
    service.decidePairing(claimId, ['agent'])
    await advance(70000)
    expect(await request(channel, 'pairing.get', { claimId })).toMatchObject({ result: { status: 'approved' } })
    await advance(59000)
    expect(socket.close).not.toHaveBeenCalled()
    await advance(1000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4000, 'Remote peer idle timeout')
  })

  it('does not let pre-auth pings extend invitation expiry', async () => {
    const { socket, channel } = await connect(false)
    for (let i = 0; i < 6; i++) {
      await advance(20000)
      await request(channel, 'connection.ping', { nonce: 'n' })
    }
    await advance(1000)
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1008, 'Remote session expired')
  })

  it('releases capacity after a genuine read failure without waiting for a close event', async () => {
    const peers = await Promise.all([connect(), connect(), connect(), connect()])
    peers[0].channel.fail(new Error('read broke'))
    await flush()
    expect(peers[0].socket.close).toHaveBeenCalledExactlyOnceWith(1011, 'Remote session failed')
    expect(warnings('Remote session ended with an error')).toHaveLength(1)
    const replacement = await connect()
    expect(replacement.socket.close).not.toHaveBeenCalled()
    peers[0].socket.closed()
    expect(warnings('Remote session ended with an error')).toHaveLength(1)
  })
})
