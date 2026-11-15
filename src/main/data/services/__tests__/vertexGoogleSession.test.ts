import { describe, expect, it } from 'vitest'

import type { AuthConfig } from '@shared/data/types/provider'

import { preserveVertexGoogleSession, toVertexAuthorizedUserView } from '../vertexGoogleSession'

const signedIn = {
  type: 'authorized_user',
  clientId: 'cid',
  clientSecret: 'cs',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
  expiresAt: 123,
  account: 'person@example.com'
}

const gcp = (credentials: Record<string, unknown>, location = 'us-central1'): AuthConfig => ({
  type: 'iam-gcp',
  project: 'p',
  location,
  credentials
})

describe('toVertexAuthorizedUserView', () => {
  it('exposes the client and a signed-in flag but never a token', () => {
    const view = toVertexAuthorizedUserView({ ...signedIn, extra: 'secret-extra' })

    expect(view).toEqual({
      type: 'authorized_user',
      clientId: 'cid',
      clientSecret: 'cs',
      account: 'person@example.com',
      signedIn: true
    })
  })

  it('reports signed out when no refresh token is stored', () => {
    expect(toVertexAuthorizedUserView({ type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' }).signedIn).toBe(
      false
    )
  })
})

describe('preserveVertexGoogleSession', () => {
  const view = {
    type: 'authorized_user',
    clientId: 'cid',
    clientSecret: 'cs',
    account: 'person@example.com',
    signedIn: true
  }

  it('keeps the stored session when a save sends back the view for the same client', () => {
    const merged = preserveVertexGoogleSession(gcp(signedIn), gcp(view, 'europe-west4'))

    expect(merged).toEqual(gcp({ ...signedIn }, 'europe-west4'))
  })

  it('drops the tokens and the echoed account when the OAuth client changes', () => {
    const merged = preserveVertexGoogleSession(gcp(signedIn), gcp({ ...view, clientId: 'other-cid' }))

    expect(merged).toEqual(gcp({ type: 'authorized_user', clientId: 'other-cid', clientSecret: 'cs' }))
  })

  it('never stores the signedIn flag or an account without a session', () => {
    expect(preserveVertexGoogleSession(null, gcp(view))).toEqual(
      gcp({ type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' })
    )
  })

  it('leaves service-account and non-Vertex configs untouched', () => {
    const serviceAccount = gcp({ privateKey: 'k', clientEmail: 'sa@x' })
    const apiKey: AuthConfig = { type: 'api-key' }

    expect(preserveVertexGoogleSession(gcp(signedIn), serviceAccount)).toBe(serviceAccount)
    expect(preserveVertexGoogleSession(gcp(signedIn), apiKey)).toBe(apiKey)
  })
})
