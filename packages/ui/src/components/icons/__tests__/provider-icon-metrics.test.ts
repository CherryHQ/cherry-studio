import { describe, expect, it } from 'vitest'

import { getProviderIconAssetMetrics } from '../provider-icon-metrics'

describe('getProviderIconAssetMetrics', () => {
  it('normalizes inset provider marks independently from their rendered size', () => {
    expect(getProviderIconAssetMetrics({ kind: 'provider', iconId: 'tavily' })).toEqual({
      canvasScale: 120 / 65,
      kind: 'mark'
    })
  })

  it.each(['anthropic', 'felo', 'abacus', 'coze'])('preserves the full canvas of %s without enlargement', (iconId) => {
    expect(getProviderIconAssetMetrics({ kind: 'provider', iconId })).toEqual({
      canvasScale: 1,
      kind: 'tile'
    })
  })

  it('normalizes model-catalog fallbacks on their native 24px canvas', () => {
    expect(getProviderIconAssetMetrics({ kind: 'model', iconId: 'claude' })).toEqual({
      canvasScale: 24 / 16,
      kind: 'mark'
    })
  })
})
