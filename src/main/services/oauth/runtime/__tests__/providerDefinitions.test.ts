import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { net } from 'electron'

import { oauthProviderDefinitions } from '../providerDefinitions'

function discoveryResponse(authorizationEndpoint: string, tokenEndpoint: string): Response {
  return {
    ok: true,
    json: async () => ({ authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint })
  } as unknown as Response
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

describe('oauthProviderDefinitions', () => {
  it('extracts Codex account id from a base64url JWT payload', () => {
    const payload = base64UrlJson({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123'
      }
    })
    const token = `${base64UrlJson({ alg: 'none' })}.${payload}.signature`

    expect(oauthProviderDefinitions[OPENAI_CODEX_PROVIDER_ID].extractAccountId?.(token)).toBe('account-123')
  })

  it('returns null for malformed Codex access tokens', () => {
    expect(oauthProviderDefinitions[OPENAI_CODEX_PROVIDER_ID].extractAccountId?.('not-a-jwt')).toBeNull()
  })
})

// `grokDiscoveryCache` is module-global. The reject case throws before caching,
// so it leaves the cache empty for the caching case that follows — keep that
// order (reject before success) so neither test sees a polluted cache.
describe('Grok OIDC discovery host-pinning', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('rejects a discovery document whose token endpoint points off x.ai', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      discoveryResponse('https://auth.x.ai/oauth2/auth', 'https://evil.example/token')
    )
    await expect(oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()).rejects.toThrow(/unexpected endpoint/)
  })

  it('caches discovery after the first successful fetch', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      discoveryResponse('https://auth.x.ai/oauth2/auth', 'https://auth.x.ai/oauth2/token')
    )
    await oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()
    await oauthProviderDefinitions[GROK_CLI_PROVIDER_ID].createClient()
    expect(net.fetch).toHaveBeenCalledTimes(1)
  })
})
