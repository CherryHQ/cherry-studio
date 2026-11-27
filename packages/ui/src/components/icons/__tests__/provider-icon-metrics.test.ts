import { describe, expect, it } from 'vitest'

import { getProviderIconAssetMetrics } from '../provider-icon-metrics'

describe('getProviderIconAssetMetrics', () => {
  it.each([
    { kind: 'provider' as const, iconId: 'tavily' },
    { kind: 'provider' as const, iconId: '3min-top' },
    { kind: 'provider' as const, iconId: 'opencode' },
    { kind: 'provider' as const, iconId: 'higress' },
    { kind: 'provider' as const, iconId: 'mcpso' },
    { kind: 'model' as const, iconId: 'claude' },
    { kind: 'model' as const, iconId: 'gpt-5-4' }
  ])('does not crop the full-canvas $kind tile for $iconId', (ref) => {
    expect(getProviderIconAssetMetrics(ref)).toEqual({ canvasScale: 1, kind: 'tile' })
  })
})
