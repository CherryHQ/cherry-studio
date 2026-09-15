import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getProviderIconAssetMetrics } from '../provider-icon-metrics'

describe('getProviderIconAssetMetrics', () => {
  it.each(['zero-one', 'minimax-agent', '3min-top'])(
    'does not enlarge the full-canvas background in the actual %s artwork', (iconId) => {
      const svg = readFileSync(fileURLToPath(new URL(`../../../../icons/providers/light/${iconId}.svg`, import.meta.url)), 'utf8')
      expect(svg).toContain('<rect width="120" height="120"')
      expect(getProviderIconAssetMetrics({ kind: 'provider', iconId }).canvasScale).toBe(1)
    }
  )
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
