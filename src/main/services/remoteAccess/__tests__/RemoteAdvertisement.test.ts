import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  address: '192.168.1.2',
  publishers: [] as Array<{
    records: unknown[]
    services: Array<EventEmitter & { destroyed?: boolean }>
    destroyed: boolean
    failed: (error: Error) => void
  }>
}))
vi.mock('node:os', () => ({
  networkInterfaces: () => ({ en0: [{ address: state.address, family: 'IPv4', internal: false }] })
}))
vi.mock('bonjour-service', () => ({
  default: class {
    records: unknown[] = []
    services: EventEmitter[] = []
    destroyed = false
    constructor(
      _options: unknown,
      readonly failed: (error: Error) => void
    ) {
      state.publishers.push(this)
    }
    publish(record: unknown) {
      this.records.push(record)
      const service = new EventEmitter()
      this.services.push(service)
      return service
    }
    unpublishAll(done: () => void) {
      this.records = []
      done()
    }
    destroy() {
      this.destroyed = true
    }
  }
}))

import { RemoteAdvertisement } from '../RemoteAdvertisement'

beforeEach(() => {
  state.publishers = []
  state.address = '192.168.1.2'
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('remote discovery advertisement lifetime', () => {
  it('advertises the actual shared port without invitation credentials and refreshes changed interfaces', () => {
    const status = vi.fn()
    const advertisement = new RemoteAdvertisement(status)
    advertisement.update('peer1', 24444)
    const first = state.publishers[0]
    expect(first.records[0]).toEqual(
      expect.objectContaining({
        port: 24444,
        txt: { v: '1', identity: 'peer1' },
        type: 'cherry-remote',
        disableIPv6: true
      })
    )
    state.address = '10.0.0.8'
    advertisement.update('peer1', 24444)
    expect(first.records).toEqual([])
    expect(first.destroyed).toBe(true)
    expect(state.publishers[1].records).toHaveLength(1)
    advertisement.stop()
    expect(state.publishers[1].destroyed).toBe(true)
  })

  it('cannot become available again from callbacks of a withdrawn publication', () => {
    const status = vi.fn()
    const advertisement = new RemoteAdvertisement(status)
    advertisement.update('peer1', 23333)
    const first = state.publishers[0]
    advertisement.stop()
    status.mockClear()
    first.services[0].emit('up')
    first.failed(new Error('late socket error'))
    expect(status).not.toHaveBeenCalled()
    expect(first.services[0].destroyed).toBe(true)
  })
})
