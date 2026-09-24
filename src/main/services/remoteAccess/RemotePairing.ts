import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

import { remoteLimits, type RemoteCapability } from '@cherrystudio/remote-protocol'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'

export interface RemotePairingClaim {
  claimId: string
  deviceName: string
  platform: string
  capabilities: RemoteCapability[]
  verificationCode: string
  expiresAt: string
}

type Claim = RemotePairingClaim & {
  peerIdentity: string
  status: 'pending' | 'rejected' | 'approved'
  deviceId?: string
}

export class RemotePairing {
  private invitation?: { invitationId: string; invitationSecret: string; expiresAt: number }
  private claim?: Claim

  create() {
    this.clear()
    this.invitation = {
      invitationId: randomUUID(),
      invitationSecret: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + remoteLimits.invitationMs
    }
    return { ...this.invitation, expiresAt: new Date(this.invitation.expiresAt).toISOString() }
  }

  claimInvitation(
    peerIdentity: string,
    input: {
      invitationId: string
      invitationSecret: string
      deviceName: string
      platform: string
      capabilities: RemoteCapability[]
    }
  ) {
    const invitation = this.invitation
    const secret = Buffer.from(input.invitationSecret)
    const expected = Buffer.from(invitation?.invitationSecret ?? '')
    if (
      !invitation ||
      invitation.expiresAt <= Date.now() ||
      input.invitationId !== invitation.invitationId ||
      secret.length !== expected.length ||
      !timingSafeEqual(secret, expected)
    )
      throw new RemoteRpcError('FORBIDDEN', 'Invitation is invalid or expired')
    if (this.claim) {
      const claim = this.claim
      if (
        claim.status !== 'pending' ||
        claim.peerIdentity !== peerIdentity ||
        claim.deviceName !== input.deviceName ||
        claim.platform !== input.platform ||
        claim.capabilities.length !== input.capabilities.length ||
        claim.capabilities.some((capability) => !input.capabilities.includes(capability))
      )
        throw new RemoteRpcError('CONFLICT', 'Invitation already claimed')
      return { claimId: claim.claimId, verificationCode: claim.verificationCode, expiresAt: claim.expiresAt }
    }
    this.claim = {
      claimId: randomUUID(),
      peerIdentity,
      deviceName: input.deviceName,
      platform: input.platform,
      capabilities: [...input.capabilities],
      verificationCode: String(randomInt(1_000_000)).padStart(6, '0'),
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      status: 'pending'
    }
    return {
      claimId: this.claim.claimId,
      verificationCode: this.claim.verificationCode,
      expiresAt: this.claim.expiresAt
    }
  }

  pending(): RemotePairingClaim[] {
    const claim = this.claim
    if (!claim || claim.status !== 'pending' || Date.parse(claim.expiresAt) <= Date.now()) return []
    return [
      {
        claimId: claim.claimId,
        deviceName: claim.deviceName,
        platform: claim.platform,
        capabilities: [...claim.capabilities],
        verificationCode: claim.verificationCode,
        expiresAt: claim.expiresAt
      }
    ]
  }

  decide(claimId: string, capabilities: RemoteCapability[] | null): void {
    const claim = this.claim
    if (!claim || claim.claimId !== claimId || claim.status !== 'pending' || Date.parse(claim.expiresAt) <= Date.now())
      throw new RemoteRpcError('NOT_FOUND', 'Pairing request expired')
    if (capabilities === null) {
      claim.status = 'rejected'
      return
    }
    if (!capabilities.length || capabilities.some((value) => !claim.capabilities.includes(value)))
      throw new RemoteRpcError('FORBIDDEN', 'Capability was not requested')
    const result = apiGatewayPairedDeviceService.approveRemote({
      name: claim.deviceName,
      platform: claim.platform,
      peerIdentity: claim.peerIdentity,
      capabilities
    })
    claim.deviceId = result.device.id
    claim.status = 'approved'
  }

  get(
    claimId: string,
    peerIdentity: string
  ): { status: 'pending' | 'rejected' | 'expired' } | { status: 'approved'; deviceId: string } {
    const claim = this.claim
    if (
      !claim ||
      claim.claimId !== claimId ||
      claim.peerIdentity !== peerIdentity ||
      Date.parse(claim.expiresAt) <= Date.now()
    )
      return { status: 'expired' }
    if (claim.status === 'approved' && claim.deviceId) return { status: 'approved', deviceId: claim.deviceId }
    return { status: claim.status === 'rejected' ? 'rejected' : 'pending' }
  }

  clear(): void {
    this.invitation = undefined
    this.claim = undefined
  }
}
