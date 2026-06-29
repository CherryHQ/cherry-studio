import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn()
  }
}))

import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'

import { oauthProviderDefinitions } from '../providerDefinitions'

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
