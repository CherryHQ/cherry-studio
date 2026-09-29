import os from 'node:os'

import type * as BonjourModule from 'bonjour-service'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  networkInterfaces: vi.fn<typeof os.networkInterfaces>(),
  address: '192.168.1.2',
  ipv6: [] as string[],
  publishers: [] as Array<{
    records: unknown[]
    services: BonjourModule.Service[]
    destroyed: boolean
    failed: (error: Error) => void
  }>
}))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  networkInterfaces: state.networkInterfaces
}))
vi.mock('bonjour-service', async (importOriginal) => {
  const { Service } = await importOriginal<typeof BonjourModule>()
  return {
    default: class {
      records: BonjourModule.ServiceConfig[] = []
      services: BonjourModule.Service[] = []
      destroyed = false
      constructor(
        _options: unknown,
        readonly failed: (error: Error) => void
      ) {
        state.publishers.push(this)
      }
      publish(record: BonjourModule.ServiceConfig) {
        this.records.push(record)
        const service = new Service(record)
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
  }
})

import { RemoteAdvertisement } from '../RemoteAdvertisement'

beforeEach(() => {
  state.publishers = []
  state.address = '192.168.1.2'
  state.ipv6 = []
  state.networkInterfaces.mockImplementation(() => ({
    en0: [
      {
        address: state.address,
        family: 'IPv4',
        internal: false,
        mac: '01:02:03:04:05:06',
        netmask: '255.255.255.0',
        cidr: null
      },
      ...state.ipv6.map((address) => ({
        address,
        family: 'IPv6' as const,
        internal: false,
        mac: '01:02:03:04:05:06',
        netmask: 'ffff:ffff:ffff:ffff::',
        cidr: null,
        scopeid: 0
      }))
    ]
  }))
  vi.spyOn(os, 'networkInterfaces').mockImplementation(state.networkInterfaces)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('remote discovery advertisement lifetime', () => {
  it('publishes only routable IPv6 records and the actual IPv4 interface', () => {
    state.ipv6 = ['fd7a::2', '2001:db8::2', 'fe80::2', 'fe90::2', 'fea0::2', 'feb0::2', 'fe80::2%en0']
    const advertisement = new RemoteAdvertisement(vi.fn())
    advertisement.update('peer1', 24444, true)
    const records = state.publishers[0].services[0].records()
    expect(
      records
        .filter((record) => record.type === 'A' || record.type === 'AAAA')
        .map((record) => record.data)
        .sort()
    ).toEqual(['192.168.1.2', '2001:db8::2', 'fd7a::2'])
    advertisement.update('peer1', 24444, false)
    expect(state.publishers[1].services[0].records().filter((record) => record.type === 'AAAA')).toEqual([])
    advertisement.stop()
  })

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

  it('withdraws IPv6 records when only IPv4 is listening on the same port', () => {
    const advertisement = new RemoteAdvertisement(vi.fn())
    advertisement.update('peer1', 24444, true)
    const first = state.publishers[0]
    expect(first.records[0]).toMatchObject({ port: 24444, disableIPv6: false })
    advertisement.update('peer1', 24444, false)
    expect(first.records).toEqual([])
    expect(state.publishers[1].records[0]).toMatchObject({ port: 24444, disableIPv6: true })
    advertisement.stop()
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
