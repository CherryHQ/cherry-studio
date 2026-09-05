import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isAgentOnlyProvider } from '../provider'

const provider = (id: string, authMethods?: Provider['authMethods']): Pick<Provider, 'id' | 'authMethods'> => ({
  id,
  authMethods
})

describe('isAgentOnlyProvider', () => {
  it('is true for external-cli providers', () => {
    expect(isAgentOnlyProvider(provider('claude-code', ['external-cli']))).toBe(true)
  })

  it('does not infer Cherry Cloud module availability from the provider', () => {
    expect(isAgentOnlyProvider(provider(CHERRY_CLOUD_PROVIDER_ID))).toBe(false)
  })

  it('is false for api-key and oauth providers', () => {
    expect(isAgentOnlyProvider(provider('openai', ['api-key']))).toBe(false)
    expect(isAgentOnlyProvider(provider('codex', ['oauth']))).toBe(false)
    expect(isAgentOnlyProvider(provider('openai'))).toBe(false)
  })
})
