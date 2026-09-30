import { describe, expect, it } from 'vitest'

import { parseVpnStatus } from '../vpnStatus'

describe('VPN status projection', () => {
  it('returns only this device’s usable IPv4, IPv6 and DNS candidates, never peer or login data', () => {
    const result = parseVpnStatus(
      'tailscale',
      JSON.stringify({
        BackendState: 'Running',
        Self: { Online: true, DNSName: 'desktop.example.ts.net.', TailscaleIPs: ['100.64.0.2', 'fd7a::2'] },
        AuthURL: 'https://login.example/secret',
        Peer: { other: { TailscaleIPs: ['100.64.0.3'] } }
      })
    )
    expect(result).toEqual({
      product: 'tailscale',
      state: 'ready',
      networks: [{ name: 'Tailscale', hosts: ['desktop.example.ts.net', '100.64.0.2', 'fd7a::2'] }]
    })
  })

  it('does not offer stale addresses while the client needs login', () => {
    expect(
      parseVpnStatus(
        'tailscale',
        JSON.stringify({ BackendState: 'NeedsLogin', Self: { TailscaleIPs: ['100.64.0.2'] } })
      )
    ).toEqual({ product: 'tailscale', state: 'needs-login', networks: [] })
  })

  it('separates ZeroTier network approval from Cherry pairing and omits unapproved addresses', () => {
    const denied = { id: 'network-a', name: 'Office', status: 'ACCESS_DENIED', assignedAddresses: ['10.2.0.2/24'] }
    expect(parseVpnStatus('zerotier', JSON.stringify([denied]))).toEqual({
      product: 'zerotier',
      state: 'needs-approval',
      networks: []
    })
    expect(
      parseVpnStatus(
        'zerotier',
        JSON.stringify([
          denied,
          { id: 'network-b', name: 'Home', status: 'OK', assignedAddresses: ['10.3.0.2/24', 'fd12::2/64'] }
        ])
      ).networks
    ).toEqual([{ name: 'Home', hosts: ['10.3.0.2', 'fd12::2'] }])
  })

  it('rejects malformed command output instead of inferring that a client is absent', () => {
    expect(() => parseVpnStatus('tailscale', '{}')).toThrow()
    expect(() => parseVpnStatus('zerotier', 'permission denied')).toThrow()
  })
})
