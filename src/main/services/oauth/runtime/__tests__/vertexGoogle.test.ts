import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getAuthConfig: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getAuthConfig: h.getAuthConfig } }))

import { net } from 'electron'

import { OAuthServiceError } from '../../errors'
import { createVertexGoogleOAuthProvider } from '../providers/vertexGoogle'

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('createVertexGoogleOAuthProvider', () => {
  const definition = createVertexGoogleOAuthProvider('my-vertex')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses to start a sign-in before the Google OAuth client is saved', () => {
    h.getAuthConfig.mockReturnValue({
      type: 'iam-gcp',
      project: 'p',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'cid', clientSecret: ' ' }
    })

    expect(() => definition.createClient()).toThrow(OAuthServiceError)
  })

  it('refuses to start a sign-in for a service-account configuration', () => {
    h.getAuthConfig.mockReturnValue({
      type: 'iam-gcp',
      project: 'p',
      location: 'global',
      credentials: { privateKey: 'k', clientEmail: 'sa@x' }
    })

    expect(() => definition.createClient()).toThrow(OAuthServiceError)
  })

  it('takes the account email from the id_token', () => {
    const idToken = `${base64UrlJson({ alg: 'RS256' })}.${base64UrlJson({ email: 'person@example.com' })}.sig`

    expect(definition.extractAccountId?.('access', { access_token: 'access', id_token: idToken })).toBe(
      'person@example.com'
    )
    expect(definition.extractAccountId?.('access', { access_token: 'access' })).toBeNull()
  })

  it('resolves when Google accepts the revocation', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 200 }))

    await expect(definition.revokeToken?.('refresh-1')).resolves.toBeUndefined()
  })

  it('rejects with the HTTP status, not the token, when Google rejects the revocation', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response(null, { status: 400 }))

    const error = await definition.revokeToken?.('refresh-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('400')
    expect((error as Error).message).not.toContain('refresh-1')
  })

  it('rejects when the revocation request fails', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new TypeError('fetch failed'))

    await expect(definition.revokeToken?.('refresh-1')).rejects.toThrow('fetch failed')
  })
})
