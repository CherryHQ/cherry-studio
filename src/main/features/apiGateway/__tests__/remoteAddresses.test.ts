import type { NetworkInterfaceInfo } from 'node:os'

import { networkInterfaces } from 'systeminformation'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getInterfaceMetadata, getRemoteAddressOptions } from '../remoteAddresses'

vi.mock('systeminformation', () => ({ networkInterfaces: vi.fn() }))

const address = (value: string, internal = false): NetworkInterfaceInfo =>
  ({
    address: value,
    family: value.includes(':') ? 'IPv6' : 'IPv4',
    internal,
    mac: '',
    netmask: '',
    cidr: null,
    ...(value.includes(':') ? { scopeid: 0 } : {})
  }) as NetworkInterfaceInfo
const nic = (iface: string, overrides = {}) => ({
  iface,
  ifaceName: iface,
  type: 'wired',
  virtual: false,
  default: false,
  ...overrides
})

describe('remote address priority', () => {
  afterEach(() => vi.useRealTimers())

  it('puts physical and tunnel IPv4 before IPv6 and virtual networks regardless of OS enumeration', () => {
    const result = getRemoteAddressOptions(
      {
        docker0: [address('172.17.0.1')],
        bridge100: [address('192.168.105.1')],
        utun6: [address('fd7a::1'), address('100.94.33.58')],
        en0: [address('2001:db8::1'), address('192.168.1.129')]
      },
      [nic('en0'), nic('utun6', { default: true }), nic('bridge100'), nic('docker0')],
      true
    )
    expect(result.map((item) => item.address)).toEqual([
      '192.168.1.129',
      '100.94.33.58',
      '2001:db8::1',
      'fd7a::1',
      '192.168.105.1',
      '172.17.0.1'
    ])
    expect(result[1].interfaceName).toBe('utun6')
  })

  it('uses the default interface within a tier and deduplicates without losing its label', () => {
    const result = getRemoteAddressOptions(
      {
        en0: [address('192.168.1.2')],
        en1: [address('192.168.2.2'), address('192.168.1.2')]
      },
      [nic('en0'), nic('en1', { default: true })],
      false
    )
    expect(result).toEqual([
      { address: '192.168.1.2', interfaceName: 'en1' },
      { address: '192.168.2.2', interfaceName: 'en1' }
    ])
  })

  it('retains unknown addresses and all IPv6 aliases but excludes loopback and scoped IPv6', () => {
    const interfaces = {
      custom: [
        address('127.0.0.1', true),
        address('10.0.0.2'),
        address('2001:db8::1'),
        address('2001:db8::2'),
        address('fe80::1'),
        address('fe80::1%custom')
      ]
    }
    expect(getRemoteAddressOptions(interfaces, [], true).map((item) => item.address)).toEqual([
      '10.0.0.2',
      '2001:db8::1',
      '2001:db8::2'
    ])
    expect(getRemoteAddressOptions(interfaces, [], false).map((item) => item.address)).toEqual(['10.0.0.2'])
  })

  it('does not discard a selectable low-priority address when there are more than 32 candidates', () => {
    const addresses = Array.from({ length: 33 }, (_, i) => address(`10.0.0.${i + 1}`))
    expect(
      getRemoteAddressOptions({ docker0: addresses, en0: [address('192.168.1.2')] }, [nic('en0')], false)
    ).toHaveLength(34)
    expect(
      getRemoteAddressOptions({ docker0: addresses, en0: [address('192.168.1.2')] }, [nic('en0')], false)[0].address
    ).toBe('192.168.1.2')
  })

  it('falls back when metadata is unavailable or stalls instead of blocking pairing', async () => {
    vi.mocked(networkInterfaces).mockRejectedValueOnce(new Error('unavailable'))
    await expect(getInterfaceMetadata()).resolves.toEqual([])
    vi.useFakeTimers()
    vi.mocked(networkInterfaces).mockImplementationOnce(() => new Promise(() => {}))
    const result = getInterfaceMetadata()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toEqual([])
  })
})
