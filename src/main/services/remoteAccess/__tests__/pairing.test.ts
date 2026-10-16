import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { remoteAuthorizationSchema as legacyAuthorizationSchema } from '@cherrystudio/remote-protocol-v0'
import { type SecureChannel } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'

import { RemoteAgentHub } from '../agentJournal'
import { RemoteConnection } from '../RemoteConnection'
import { RemotePairing } from '../RemotePairing'
import { RemoteTokens } from '../RemoteTokens'

function channel(remoteIdentity: string, version = 1): SecureChannel {
  return {
    remoteIdentity,
    protocolVersion: version,
    offeredVersions: [version],
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

  it('hands off addresses only to an authenticated device with a current approved capability', async () => {
    const { device } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['agent']
    })
    const snapshot = {
      desktopIdentity: 'desktop',
      endpoints: [{ host: '100.64.0.2', port: 23333, security: 'ws' as const }]
    }
    const connection = new RemoteConnection(
      channel('phone'),
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      new RemoteAgentHub(),
      async () => snapshot
    )
    const hello = await request(connection, 'connection.hello', { protocolVersions: [1] })
    expect(hello).toMatchObject({ result: { connectionEndpointsVersion: 1 } })
    expect(await request(connection, 'connection.endpoints', { domain: 'agent' })).toMatchObject({
      error: { data: { reason: 'UNAUTHENTICATED' } }
    })
    await request(connection, 'connection.authenticate', { deviceId: device.id })
    expect(await request(connection, 'connection.endpoints', { domain: 'configuration' })).toMatchObject({
      error: { data: { reason: 'FORBIDDEN' } }
    })
    expect(await request(connection, 'connection.endpoints', { domain: 'agent' })).toMatchObject({ result: snapshot })
    apiGatewayPairedDeviceService.revokeRemoteCapability(device.id, 'agent')
    expect(await request(connection, 'connection.endpoints', { domain: 'agent' })).toMatchObject({
      error: { data: { reason: 'GRANT_REVOKED' } }
    })
    connection.dispose()
  })

  it('makes the approved capability usable immediately and refuses credential export for Agent-only pairing', async () => {
    const pairing = new RemotePairing()
    const invitation = pairing.create()
    const connection = new RemoteConnection(
      channel('phone'),
      pairing,
      new RemoteTokens(),
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
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
    const connection = new RemoteConnection(
      channel('phone'),
      pairing,
      tokens,
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
    )
    await request(connection, 'connection.hello', { protocolVersions: [1] })
    expect(await request(connection, 'connection.authenticate', { deviceId: device.id })).toMatchObject({
      result: { deviceId: device.id }
    })
    const other = new RemoteConnection(
      channel('other-phone'),
      pairing,
      tokens,
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
    )
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
  it('adds Assistant access without rotating existing grants or breaking legacy authentication and refresh', async () => {
    const first = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['agent', 'configuration']
    })
    const tokens = new RemoteTokens()
    const connection = new RemoteConnection(
      channel('phone'),
      new RemotePairing(),
      tokens,
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
    )
    await request(connection, 'connection.hello', { protocolVersions: [1] })
    await request(connection, 'connection.authenticate', { deviceId: first.device.id })
    const added = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['assistant']
    })
    expect(added.authorization.grants).toEqual(expect.arrayContaining(first.authorization.grants))
    expect(added.authorization.grants).toHaveLength(3)
    const refreshed = await request(connection, 'connection.refresh', {})
    expect(refreshed).toMatchObject({ result: { authorization: first.authorization } })
    expect(
      legacyAuthorizationSchema.safeParse((refreshed as { result: { authorization: unknown } }).result.authorization)
        .success
    ).toBe(true)
    apiGatewayPairedDeviceService.revokeRemoteCapability(first.device.id, 'assistant')
    expect(connection.requireCapability('agent').grantId).toBe(
      first.authorization.grants.find((grant) => grant.domain === 'agent')!.grantId
    )
    connection.dispose()
  })

  it('accepts Assistant-only authorization on protocol 2 and never permits provider export', async () => {
    const approved = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['assistant']
    })
    const connection = new RemoteConnection(
      channel('phone', 2),
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
    )
    expect(await request(connection, 'connection.hello', { protocolVersions: [2] })).toMatchObject({
      result: { assistantVersion: 1, uploadsVersion: 1 }
    })
    expect(await request(connection, 'connection.authenticate', { deviceId: approved.device.id })).toMatchObject({
      result: { authorization: { grants: [{ domain: 'assistant' }] } }
    })
    expect(connection.requireCapability('assistant')).toMatchObject({ deviceId: approved.device.id })
    expect(await request(connection, 'configuration.export.prepare', {})).toMatchObject({
      error: { data: { reason: 'FORBIDDEN' } }
    })
    expect(await request(connection, 'agent.agents.list', {})).toMatchObject({
      error: { data: { reason: 'FORBIDDEN' } }
    })
    expect(await request(connection, 'uploads.get', { domain: 'agent', uploadId: 'upload' })).toMatchObject({
      error: { data: { reason: 'FORBIDDEN' } }
    })
    apiGatewayPairedDeviceService.revokeRemoteCapability(approved.device.id, 'assistant')
    expect(await request(connection, 'assistant.assistants.list', {})).toMatchObject({
      error: { data: { reason: 'GRANT_REVOKED' } }
    })
    connection.dispose()
  })

  it('routes domain-tagged DATA records to their grant and keeps legacy Agent acknowledgements', async () => {
    const approved = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['agent', 'assistant']
    })
    const writes: unknown[] = []
    const connection = new RemoteConnection(
      {
        ...channel('phone', 2),
        async write(value) {
          writes.push(value)
        }
      },
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      new RemoteAgentHub(),
      async () => ({ desktopIdentity: 'desktop', endpoints: [] })
    )
    await request(connection, 'connection.hello', { protocolVersions: [2] })
    await request(connection, 'connection.authenticate', { deviceId: approved.device.id })
    const intakeWrite = vi.mocked(application.get('FileIntakeService').write)
    intakeWrite.mockResolvedValue({
      uploadId: 'upload',
      writerEpoch: '0',
      committedOffset: '1',
      state: 'receiving',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const chunk = {
      kind: 'upload' as const,
      uploadId: 'upload',
      writerEpoch: '0',
      offset: '0',
      bytes: new Uint8Array([1])
    }
    await connection.receiveUpload({ ...chunk, requestId: 'assistant', domain: 'assistant' })
    await connection.receiveUpload({ ...chunk, requestId: 'legacy' })
    expect(writes).toMatchObject([
      { method: 'uploads.ack', params: { ok: true, requestId: 'assistant' } },
      { method: 'agent.uploads.ack', params: { ok: true, requestId: 'legacy' } }
    ])
    expect(intakeWrite.mock.calls.map(([scope]) => JSON.parse(scope.ownerId)[0])).toEqual([
      'remote-assistant',
      'remote-agent'
    ])
    connection.dispose()
  })
})
