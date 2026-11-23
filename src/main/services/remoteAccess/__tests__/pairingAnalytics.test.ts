import { beforeEach, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const trackProductEvent = vi.hoisted(() => vi.fn())
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AnalyticsService: { trackProductEvent } })
})

import { RemoteAccessService } from '../RemoteAccessService'
import type { RemotePairing } from '../RemotePairing'

beforeEach(() => {
  BaseService.resetInstances()
  trackProductEvent.mockClear()
})

function claimPairing(service: RemoteAccessService) {
  const pairing = (service as unknown as { pairing: RemotePairing }).pairing
  const invitation = pairing.create()
  return pairing.claimInvitation('phone', {
    invitationId: invitation.invitationId,
    invitationSecret: invitation.invitationSecret,
    deviceName: "Alice's iPhone",
    platform: 'ios',
    capabilities: ['agent']
  })
}

const reported = () => trackProductEvent.mock.calls.map(([event]) => event)

it('reports a rejected pairing once, and nothing for a retry on the settled claim', () => {
  const service = new RemoteAccessService()
  const claim = claimPairing(service)

  service.decidePairing(claim.claimId, null)
  expect(() => service.decidePairing(claim.claimId, ['agent'])).toThrow('expired')

  expect(reported()).toEqual([{ event: 'remote_paired', result: 'rejected' }])
  expect(JSON.stringify(reported())).not.toContain('Alice')
})

it('reports a claim that times out once, however often the phone polls it', () => {
  vi.useFakeTimers()
  try {
    const service = new RemoteAccessService()
    const claim = claimPairing(service)
    const pairing = (service as unknown as { pairing: RemotePairing }).pairing

    vi.setSystemTime(Date.parse(claim.expiresAt) + 1)
    expect(pairing.get(claim.claimId, 'phone')).toEqual({ status: 'expired' })
    // The phone sees the timeout first; nobody decided.
    expect(reported()).toEqual([{ event: 'remote_paired', result: 'expired' }])
    expect(() => service.decidePairing(claim.claimId, ['agent'])).toThrow('expired')

    expect(reported()).toEqual([{ event: 'remote_paired', result: 'expired' }])
  } finally {
    vi.useRealTimers()
  }
})
