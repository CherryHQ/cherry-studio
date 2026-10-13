import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import type * as NetModule from 'node:net'
import { createConnection } from 'node:net'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

import { LanTransferService } from '../LanTransferService'

const { browser } = vi.hoisted(() => ({ browser: { current: null as EventEmitter | null } }))

vi.mock('electron', () => ({
  app: { getName: () => 'Cherry Studio', getVersion: () => '1.0.0' },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

vi.mock('bonjour-service', () => ({
  default: class {
    find() {
      return browser.current
    }
    destroy() {}
  }
}))

vi.mock('node:net', async (importOriginal) => ({
  ...(await importOriginal<typeof NetModule>()),
  createConnection: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    promises: { ...actual.promises, stat: vi.fn() },
    createReadStream: vi.fn()
  }
})

class PeerSocket extends EventEmitter {
  destroyed = false
  writable = true
  starts: Array<{ transferId: string; fileName: string }> = []
  setKeepAlive() {}
  setTimeout() {}
  cork() {}
  uncork() {}
  write(data: string | Buffer) {
    if (typeof data !== 'string') return true
    const message = JSON.parse(data)
    if (message.type === 'handshake') this.reply({ type: 'handshake_ack', accepted: true })
    if (message.type === 'file_start') {
      this.starts.push(message)
      this.reply({ type: 'file_start_ack', transferId: message.transferId, accepted: true })
    }
    if (message.type === 'file_end') {
      this.reply({ type: 'file_complete', transferId: message.transferId, success: true, filePath: '/backup.zip' })
    }
    return true
  }
  reply(message: object) {
    queueMicrotask(() => this.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)))
  }
  destroy() {
    this.destroyed = true
    this.writable = false
    queueMicrotask(() => this.emit('close'))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('LAN sending ownership', () => {
  let service: LanTransferService
  let socket: PeerSocket
  const stats = fs.statSync('package.json')
  const contents = fs.readFileSync('package.json')

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    browser.current = Object.assign(new EventEmitter(), { start() {}, stop() {} })
    socket = new PeerSocket()
    vi.mocked(createConnection).mockImplementation((_options, connected) => {
      queueMicrotask(() => connected?.())
      return socket as unknown as ReturnType<typeof createConnection>
    })
    vi.mocked(fs.promises.stat).mockResolvedValue(stats)
    vi.mocked(fs.createReadStream).mockImplementation(() => Readable.from([contents]) as fs.ReadStream)
    service = new LanTransferService()
    service.startDiscovery()
    browser.current.emit('up', { name: 'Phone', host: 'phone.local', port: 1234, addresses: ['127.0.0.1'] })
    await service.connectAndHandshake({ peerId: service.getState().services[0].id })
  })

  afterEach(async () => {
    service.cancelTransfer()
    await service.disconnect()
    service.stopDiscovery()
  })

  it('rejects a second send during file preparation and lets the first send finish', async () => {
    const preparation = deferred<fs.Stats>()
    vi.mocked(fs.promises.stat).mockReturnValueOnce(preparation.promise)
    const first = service.sendFile('first.zip')
    const firstOutcome = first.then(
      (value) => value,
      (error) => error
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    const second = service.sendFile('second.zip')
    const secondOutcome = second.then(
      (value) => value,
      (error) => error
    )
    try {
      await expect(secondOutcome).resolves.toEqual(new Error('A file transfer is already in progress'))
    } finally {
      preparation.resolve(stats)
      await Promise.all([firstOutcome, secondOutcome])
    }
    await expect(first).resolves.toMatchObject({ success: true, filePath: '/backup.zip' })
    expect(socket.starts.map((message) => message.fileName)).toEqual(['first.zip'])
  })

  it('cancels a send during preparation without starting it and permits the next send', async () => {
    const preparation = deferred<fs.Stats>()
    vi.mocked(fs.promises.stat).mockReturnValueOnce(preparation.promise)
    const first = service.sendFile('cancelled.zip')
    const firstOutcome = first.then(
      (value) => value,
      (error) => error
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    service.cancelTransfer()
    preparation.resolve(stats)
    await expect(firstOutcome).resolves.toEqual(new Error('Transfer cancelled by user'))
    await expect(service.sendFile('next.zip')).resolves.toMatchObject({ success: true })
    expect(socket.starts.map((message) => message.fileName)).toEqual(['next.zip'])
  })
})
