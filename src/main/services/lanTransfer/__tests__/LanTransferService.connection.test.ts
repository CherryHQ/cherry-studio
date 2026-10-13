import { EventEmitter } from 'node:events'
import type * as NetModule from 'node:net'
import { createConnection } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { LanTransferService } from '../LanTransferService'

const network = vi.hoisted(() => ({ browser: null as EventEmitter | null }))

vi.mock('bonjour-service', () => ({
  default: class {
    find() {
      return network.browser
    }
    destroy() {}
  }
}))

vi.mock('node:net', async (importOriginal) => ({
  ...(await importOriginal<typeof NetModule>()),
  createConnection: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getName: () => 'Cherry Studio', getVersion: () => '2.0.0' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

class TestSocket extends EventEmitter {
  destroyed = false
  writable = true
  messages: string[] = []
  connectCallback?: () => void
  timeoutCallback?: () => void
  setKeepAlive() {}
  setTimeout(_ms: number, callback?: () => void) {
    if (callback) this.timeoutCallback = callback
    return this
  }
  write(message: string) {
    this.messages.push(message)
    return true
  }
  destroy() {
    if (!this.destroyed) {
      this.destroyed = true
      this.writable = false
      queueMicrotask(() => this.emit('close'))
    }
    return this
  }
  accept() {
    this.connectCallback?.()
    this.emit('data', Buffer.from('{"type":"handshake_ack","accepted":true}\n'))
  }
}

describe('LAN connection ownership', () => {
  let service: LanTransferService
  let peerId: string
  let sockets: TestSocket[]

  beforeEach(async () => {
    vi.useFakeTimers()
    BaseService.resetInstances()
    sockets = []
    network.browser = Object.assign(new EventEmitter(), { start() {}, stop() {} })
    vi.mocked(createConnection).mockImplementation(((_options: unknown, callback: () => void) => {
      const socket = new TestSocket()
      socket.connectCallback = callback
      sockets.push(socket)
      return socket
    }) as typeof createConnection)
    service = new LanTransferService()
    await service._doInit()
    service.startDiscovery()
    network.browser.emit('up', {
      name: 'Phone',
      host: 'phone.local',
      port: 12345,
      addresses: ['192.168.1.2']
    })
    peerId = service.getState().services[0].id
  })

  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects a simultaneous connect while preserving the first handshake', async () => {
    const first = service.connectAndHandshake({ peerId })
    const second = service.connectAndHandshake({ peerId }).catch((error: Error) => error)
    await Promise.resolve()
    sockets[0].accept()
    sockets[1]?.accept()
    expect(await second).toEqual(new Error('LAN transfer client is busy'))
    await expect(first).resolves.toMatchObject({ accepted: true })
  })

  it('disconnect cancels a pending TCP connect and settles its caller', async () => {
    let outcome: unknown
    void service.connectAndHandshake({ peerId }).then(
      (ack) => {
        outcome = ack
      },
      (error: Error) => {
        outcome = error
      }
    )
    await Promise.resolve()
    await service.disconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual(new Error('LAN transfer socket disconnected'))
    expect(sockets[0].destroyed).toBe(true)
    sockets[0].accept()
    expect(sockets[0].messages).toEqual([])
  })

  it('stop cancels a pending TCP connect and rejects its caller', async () => {
    let outcome: unknown
    void service.connectAndHandshake({ peerId }).catch((error: Error) => {
      outcome = error
    })
    await Promise.resolve()
    await service._doStop()
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual(new Error('LAN transfer service disposed'))
    sockets[0].accept()
    expect(sockets[0].destroyed).toBe(true)
    expect(sockets[0].messages).toEqual([])
  })

  it('ignores old connect, error, close, timeout and data callbacks during a new handshake', async () => {
    const old = service.connectAndHandshake({ peerId }).catch((error: Error) => error)
    await Promise.resolve()
    const oldSocket = sockets[0]
    await service.disconnect()
    await expect(old).resolves.toBeInstanceOf(Error)

    const next = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    oldSocket.connectCallback?.()
    oldSocket.timeoutCallback?.()
    oldSocket.emit('error', new Error('late connection error'))
    oldSocket.emit('close')
    oldSocket.emit('data', Buffer.from('{"type":"handshake_ack","accepted":false}\n'))
    sockets[1].accept()
    await expect(next).resolves.toMatchObject({ accepted: true })
    expect(sockets[1].destroyed).toBe(false)
    expect(oldSocket.messages).toEqual([])
  })

  it('can cancel a replacement while it is waiting for the old socket to close', async () => {
    const first = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    sockets[0].accept()
    await first
    sockets[0].destroy = function () {
      this.destroyed = true
      return this
    }

    const replacement = service.connectAndHandshake({ peerId }).catch((error: Error) => error)
    const duplicate = service.connectAndHandshake({ peerId }).catch((error: Error) => error)
    await service.disconnect()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await duplicate).toEqual(new Error('LAN transfer client is busy'))
    expect(await replacement).toEqual(new Error('LAN transfer socket disconnected'))
    expect(sockets).toHaveLength(1)
  })

  it('does not let an old established socket settle a new handshake', async () => {
    const first = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    sockets[0].accept()
    await first
    await service.disconnect()
    const next = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    sockets[1].connectCallback?.()
    sockets[0].emit('data', Buffer.from('{"type":"handshake_ack","accepted":false}\n'))
    sockets[1].emit('data', Buffer.from('{"type":"handshake_ack","accepted":true}\n'))
    await expect(next).resolves.toMatchObject({ accepted: true })
  })

  it('allows a retry after the network rejects connection creation synchronously', async () => {
    vi.mocked(createConnection).mockImplementationOnce(() => {
      throw new Error('network unavailable')
    })
    await expect(service.connectAndHandshake({ peerId })).rejects.toThrow('network unavailable')
    const retry = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    sockets[0].accept()
    await expect(retry).resolves.toMatchObject({ accepted: true })
  })

  it('rejects handshake write errors and allows a retry', async () => {
    const first = service.connectAndHandshake({ peerId }).catch((error: Error) => error)
    await Promise.resolve()
    sockets[0].write = () => {
      throw new Error('write failed')
    }
    sockets[0].connectCallback?.()
    expect(await first).toEqual(new Error('write failed'))
    const retry = service.connectAndHandshake({ peerId })
    await Promise.resolve()
    sockets[1].accept()
    await expect(retry).resolves.toMatchObject({ accepted: true })
  })
})
