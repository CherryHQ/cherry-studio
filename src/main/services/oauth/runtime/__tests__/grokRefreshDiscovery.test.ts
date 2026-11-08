import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import type { AuthConfig } from '@shared/data/types/provider'

import { OAuthTransientError } from '../../errors'
import { OAuthRuntimeService } from '../OAuthRuntimeService'

const { providerStore } = vi.hoisted(() => ({
  providerStore: new Map<string, { authConfig?: AuthConfig; isEnabled?: boolean }>()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getAuthConfig: vi.fn((id: string) => providerStore.get(id)?.authConfig ?? null),
    update: vi.fn((id: string, patch: { authConfig?: AuthConfig; isEnabled?: boolean }) => {
      providerStore.set(id, { ...providerStore.get(id), ...patch })
    })
  }
}))

vi.mock('../providerDefinitions', async () => {
  const { grokOAuthProvider } = await import('../providers/grok')
  return { oauthProviderDefinitions: { [grokOAuthProvider.providerId]: grokOAuthProvider } }
})

describe('Grok refresh discovery failure', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    providerStore.clear()
    vi.mocked(net.fetch).mockReset()
  })

  it('retries a discovery HTTP 403 without clearing or disabling an expired session', async () => {
    providerStore.set(GROK_CLI_PROVIDER_ID, {
      authConfig: {
        type: 'oauth',
        clientId: 'grok-client',
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1_000
      },
      isEnabled: true
    })
    vi.mocked(net.fetch).mockResolvedValue(new Response('', { status: 403 }))
    const runtime = new OAuthRuntimeService()

    await expect.soft(runtime.getValidAccessToken(GROK_CLI_PROVIDER_ID)).rejects.toBeInstanceOf(OAuthTransientError)
    expect.soft(providerStore.get(GROK_CLI_PROVIDER_ID)?.authConfig).toMatchObject({
      type: 'oauth',
      refreshToken: 'refresh-token'
    })
    expect.soft(providerStore.get(GROK_CLI_PROVIDER_ID)?.isEnabled).not.toBe(false)
    expect(vi.mocked(net.fetch).mock.calls.map(([url]) => String(url))).toEqual([
      'https://auth.x.ai/.well-known/openid-configuration'
    ])
  })
})
