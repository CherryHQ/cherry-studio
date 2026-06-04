import { describe, expect, it } from 'vitest'

import { BedrockExtension } from '../index'

/**
 * Bedrock runs Anthropic models, so its provider exposes the same server-side
 * web-search / web-fetch tools as the native `anthropic` extension. These
 * factories must be wired (regression for the dropped-during-port gap).
 */
describe('BedrockExtension toolFactories', () => {
  const fakeProvider = {
    tools: {
      webSearch_20260209: (config: unknown) => ({ tool: 'webSearch_20260209', config }),
      webFetch_20260209: (config: unknown) => ({ tool: 'webFetch_20260209', config })
    }
  }

  it('wires webSearch to the provider web-search tool', () => {
    const factory = BedrockExtension.config.toolFactories?.webSearch
    expect(factory).toBeDefined()
    const result = factory(fakeProvider as any)({ maxUses: 3 } as any)
    expect(result).toEqual({ tools: { webSearch: { tool: 'webSearch_20260209', config: { maxUses: 3 } } } })
  })

  it('wires urlContext to the provider web-fetch tool', () => {
    const factory = BedrockExtension.config.toolFactories?.urlContext
    expect(factory).toBeDefined()
    const result = factory(fakeProvider as any)({} as any)
    expect(result).toEqual({ tools: { urlContext: { tool: 'webFetch_20260209', config: {} } } })
  })
})
