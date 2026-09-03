import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isAgentOnlyProvider } from '../provider'

const provider = (id: string, authMethods?: Provider['authMethods']): Pick<Provider, 'id' | 'authMethods'> => ({
  id,
  authMethods
})

describe('isAgentOnlyProvider', () => {
  it('is true for external-cli providers in every edition', () => {
    expect(isAgentOnlyProvider(provider('claude-code', ['external-cli']), 'cn')).toBe(true)
    expect(isAgentOnlyProvider(provider('claude-code', ['external-cli']), 'global')).toBe(true)
  })

  it('follows CHERRY_CLOUD_AUDIENCE for the Cherry Cloud provider', () => {
    expect(isAgentOnlyProvider(provider(CHERRY_CLOUD_PROVIDER_ID), 'cn')).toBe(true)
    expect(isAgentOnlyProvider(provider(CHERRY_CLOUD_PROVIDER_ID), 'global')).toBe(false)
  })

  it('is false for api-key and oauth providers', () => {
    expect(isAgentOnlyProvider(provider('openai', ['api-key']), 'cn')).toBe(false)
    expect(isAgentOnlyProvider(provider('codex', ['oauth']), 'cn')).toBe(false)
    expect(isAgentOnlyProvider(provider('openai'), 'global')).toBe(false)
  })
})
