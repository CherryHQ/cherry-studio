import { describe, expect, it } from 'vitest'

import type { ProviderModelOffer, ProviderModelTemplate } from '../../src/providers/types'
import { deriveOverrideModelId } from '../canonicalize'

describe('deriveOverrideModelId', () => {
  it.each([
    ['mimo-v2.6-pro', 'mimo-v2-6-pro'],
    ['MiniMax-M3.1-Flash', 'minimax-m3-1-flash'],
    ['deepseek/deepseek-v3.2', 'deepseek-v3-2'],
    ['qwen-plus-2025-12-01', 'qwen-plus']
  ])('keeps the exact request ID %s and derives catalog key %s', (apiModelId, modelId) => {
    expect(deriveOverrideModelId({ apiModelId })).toEqual({ modelId, apiModelId })
  })

  it('omits a request ID that already equals the catalog key', () => {
    expect(deriveOverrideModelId({ apiModelId: 'deepseek-r1' })).toEqual({ modelId: 'deepseek-r1' })
  })

  it('keeps an explicit key instead of deriving another catalog identity', () => {
    expect(deriveOverrideModelId({ modelId: 'qwen-plus-2025-12-01', apiModelId: 'vendor/qwen-plus' })).toEqual({
      modelId: 'qwen-plus-2025-12-01',
      apiModelId: 'vendor/qwen-plus'
    })
  })
})

// Compile-time contract, enforced by the node typecheck project.
// @ts-expect-error a served model must spell the exact request ID
export const offerWithoutRequestId: ProviderModelOffer = { modelId: 'mimo-v2-6-pro' }
// @ts-expect-error a models.dev template takes its request ID from the upstream listing
export const templateWithRequestId: ProviderModelTemplate = { modelId: 'qwen-plus', apiModelId: 'qwen-plus' }
