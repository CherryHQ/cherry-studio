import { describe, expect, it } from 'vitest'

import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../paintingProviderMode'

describe('resolvePaintingTabForMode', () => {
  it("returns 'default' for every supported db mode (single-tab providers)", () => {
    // Every painting provider is single-tab post-unification. Whether a
    // specific (provider, model) actually supports edit/remix/upscale is
    // resolved at the form/transport layer via `imageGenerationToFields`'s
    // first-mode fallback — not via the provider's tab whitelist.
    const provider = resolvePaintingProviderDefinition('zhipu')
    expect(resolvePaintingTabForMode(provider, 'generate')).toBe('default')
    expect(resolvePaintingTabForMode(provider, 'draw')).toBe('default')
    expect(resolvePaintingTabForMode(provider, 'edit')).toBe('default')
  })

  it('returns undefined for an unrecognized db mode', () => {
    expect(resolvePaintingTabForMode(resolvePaintingProviderDefinition('zhipu'), 'hallucinate')).toBeUndefined()
  })
})
