import { describe, expect, it } from 'vitest'

import { providerRegistry } from '../../providers/registry'
import { resolvePaintingTabForMode } from '../paintingProviderMode'

describe('resolvePaintingTabForMode', () => {
  it("aliases 'draw' to the single 'default' tab on a generate-only provider", () => {
    // Every provider in the unified registry is single-tab now (intent is
    // encoded by the model id, not by UI tabs). 'draw' aliases to 'generate'
    // via MODE_ALIASES, so the resolver lands on the generate tab.
    expect(resolvePaintingTabForMode(providerRegistry.zhipu, 'draw')).toBe('default')
    expect(resolvePaintingTabForMode(providerRegistry.zhipu, 'generate')).toBe('default')
  })

  it('returns undefined when the requested mode has no compatible tab', () => {
    expect(resolvePaintingTabForMode(providerRegistry.zhipu, 'edit')).toBeUndefined()
  })
})
