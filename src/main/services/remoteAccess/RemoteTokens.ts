import { createHash, randomBytes } from 'node:crypto'

import { remoteLimits, type RemoteAuthorization } from '@cherrystudio/remote-protocol'
import { RemoteRpcError } from '@cherrystudio/remote-transport'

interface Token {
  deviceId: string
  peerIdentity: string
  authorization: RemoteAuthorization
  expiresAt: number
}

export function sameAuthorization(left: RemoteAuthorization, right: RemoteAuthorization): boolean {
  return (
    left.grants.length === right.grants.length &&
    left.grants.every((value) =>
      right.grants.some((other) => other.domain === value.domain && other.grantId === value.grantId)
    )
  )
}

export class RemoteTokens {
  private readonly tokens = new Map<string, Token>()

  issue(deviceId: string, peerIdentity: string, authorization: RemoteAuthorization) {
    this.sweep()
    const existing = [...this.tokens].filter(([, value]) => value.deviceId === deviceId)
    for (const [hash] of existing.slice(0, Math.max(0, existing.length - 1))) this.tokens.delete(hash)
    if (this.tokens.size >= 128) throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Too many active device tokens')
    const accessToken = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + remoteLimits.tokenMs
    this.tokens.set(this.hash(accessToken), { deviceId, peerIdentity, authorization, expiresAt })
    return { accessToken, authorization, expiresAt: new Date(expiresAt).toISOString() }
  }

  validate(accessToken: string, deviceId: string, peerIdentity: string, authorization: RemoteAuthorization): void {
    const token = this.tokens.get(this.hash(accessToken))
    if (!token || token.expiresAt <= Date.now()) throw new RemoteRpcError('TOKEN_EXPIRED', 'Device token expired')
    if (
      token.deviceId !== deviceId ||
      token.peerIdentity !== peerIdentity ||
      !sameAuthorization(token.authorization, authorization)
    )
      throw new RemoteRpcError('UNAUTHENTICATED', 'Device token does not match this identity')
  }

  sweep(): void {
    for (const [hash, token] of this.tokens) if (token.expiresAt <= Date.now()) this.tokens.delete(hash)
  }
  clear(): void {
    this.tokens.clear()
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
