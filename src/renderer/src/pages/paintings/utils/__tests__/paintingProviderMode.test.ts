import { describe, expect, it } from 'vitest'

import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../paintingProviderMode'

describe('resolvePaintingTabForMode', () => {
  it("aliases 'draw' to the single 'default' tab on a generate-only provider", () => {
    // Every painting provider is single-tab post-unification (intent is
    // encoded by the model id, not by UI tabs). 'draw' aliases to 'generate'
    // via MODE_ALIASES, so the resolver lands on the generate tab.
    const provider = resolvePaintingProviderDefinition('zhipu')
    expect(resolvePaintingTabForMode(provider, 'draw')).toBe('default')
    expect(resolvePaintingTabForMode(provider, 'generate')).toBe('default')
  })

  it('returns undefined when the requested mode has no compatible tab', () => {
    expect(resolvePaintingTabForMode(resolvePaintingProviderDefinition('zhipu'), 'edit')).toBeUndefined()
  })
})
