import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { type SecureChannel } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'

import { RemoteAgentHub } from '../agentJournal'
import { RemoteConnection } from '../RemoteConnection'
import { RemotePairing } from '../RemotePairing'
import { RemoteTokens } from '../RemoteTokens'

function channel(remoteIdentity: string): SecureChannel {
  return {
    remoteIdentity,
    protocolVersion: 1,
    offeredVersions: [1],
    async read() {
      throw new Error('Unused')
    },
    async write() {},
    async close() {},
    abort() {}
  }
}

function request(connection: RemoteConnection, method: string, params: unknown) {
  return connection.rpc.receive({ jsonrpc: '2.0', id: 'request', method, params }, undefined)
}

describe('pairing-time capability authorization', () => {
  setupTestDatabase()

  it('makes the approved capability usable immediately and refuses credential export for Agent-only pairing', async () => {
    const pairing = new RemotePairing()
    const invitation = pairing.create()
    const connection = new RemoteConnection(
      channel('phone'),
      pairing,
      new RemoteTokens(),
      () => {},
      new RemoteAgentHub()
    )
    await request(connection, 'connection.hello', { protocolVersions: [1] })
    const claim = await request(connection, 'pairing.claim', {
      invitationId: invitation.invitationId,
      invitationSecret: invitation.invitationSecret,
      deviceName: 'Phone',
      platform: 'ios',
      capabilities: ['agent']
    })
    expect(claim).toMatchObject({
      result: { claimId: expect.any(String), verificationCode: expect.stringMatching(/^\d{6}$/) }
    })
    const pending = pairing.pending()[0]
    expect(pairing.get(pending.claimId, 'other-phone')).toEqual({ status: 'expired' })
    expect(() => pairing.decide(pending.claimId, ['configuration'])).toThrow('Capability was not requested')
    pairing.decide(pending.claimId, ['agent'])
    expect(await request(connection, 'pairing.get', { claimId: pending.claimId })).toMatchObject({
      result: { status: 'approved', authorization: { grants: [{ domain: 'agent' }] } }
    })
    expect(connection.requireCapability('agent')).toEqual({ deviceId: expect.any(String), grantId: expect.any(String) })
    expect(await request(connection, 'configuration.export.prepare', {})).toMatchObject({
      error: { code: 1000, data: { reason: 'FORBIDDEN' } }
    })
  })

  it('requires the approved key on reconnect, then rejects queued output after revocation', async () => {
    const { device } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['configuration']
    })
    const tokens = new RemoteTokens()
    const pairing = new RemotePairing()
    const connection = new RemoteConnection(channel('phone'), pairing, tokens, () => {}, new RemoteAgentHub())
    await request(connection, 'connection.hello', { protocolVersions: [1] })
    expect(await request(connection, 'connection.authenticate', { deviceId: device.id })).toMatchObject({
      result: { deviceId: device.id }
    })
    const other = new RemoteConnection(channel('other-phone'), pairing, tokens, () => {}, new RemoteAgentHub())
    await request(other, 'connection.hello', { protocolVersions: [1] })
    expect(await request(other, 'connection.authenticate', { deviceId: device.id })).toMatchObject({
      error: { data: { reason: 'UNAUTHENTICATED' } }
    })
    const output = connection.send({ confidential: true })
    apiGatewayPairedDeviceService.revokeRemoteCapability(device.id, 'configuration')
    await expect(output).rejects.toThrow('Device authorization changed')
  })

  it('consumes each invitation once and never approves an expired or rejected claim', () => {
    const pairing = new RemotePairing()
    const invitation = pairing.create()
    const input = {
      invitationId: invitation.invitationId,
      invitationSecret: invitation.invitationSecret,
      deviceName: 'Phone',
      platform: 'ios',
      capabilities: ['configuration'] as const
    }
    const claim = pairing.claimInvitation('phone', { ...input, capabilities: [...input.capabilities] })
    expect(pairing.claimInvitation('phone', { ...input, capabilities: [...input.capabilities] })).toEqual(claim)
    expect(pairing.pending()).toHaveLength(1)
    for (const changed of [{ deviceName: 'Changed' }, { platform: 'android' }, { capabilities: ['agent'] as const }]) {
      expect(() =>
        pairing.claimInvitation('phone', {
          ...input,
          ...changed,
          capabilities: [...(changed.capabilities ?? input.capabilities)]
        })
      ).toThrow('already claimed')
    }
    expect(() => pairing.claimInvitation('other', { ...input, capabilities: [...input.capabilities] })).toThrow(
      'already claimed'
    )
    pairing.decide(claim.claimId, null)
    expect(() => pairing.claimInvitation('phone', { ...input, capabilities: [...input.capabilities] })).toThrow(
      'already claimed'
    )
    expect(pairing.get(claim.claimId, 'phone')).toEqual({ status: 'rejected' })
    expect(() => pairing.decide(claim.claimId, ['configuration'])).toThrow('expired')
    pairing.create()
    expect(pairing.get(claim.claimId, 'phone')).toEqual({ status: 'expired' })
    expect(apiGatewayPairedDeviceService.list()).toEqual([])
  })
})
