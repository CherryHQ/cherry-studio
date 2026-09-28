import { describe, expect, it } from 'vitest'

import { DEFAULT_MODEL_QUALITY_SCORE, getModelQualityScore } from '../modelQuality'

describe('getModelQualityScore', () => {
  it('ranks a current frontier model above a previous-generation one', () => {
    expect(getModelQualityScore('openai/gpt-6-astra-20260903')).toBeGreaterThan(
      getModelQualityScore('openai/gpt-4o-2024-08-06')
    )
  })

  it('ranks a flagship above the flash variant of the same family', () => {
    expect(getModelQualityScore('z-ai/glm-5.3-20260816')).toBeGreaterThan(
      getModelQualityScore('z-ai/glm-5.3-flash-20260826')
    )
  })

  it('scores a free agentic model above a tiny one', () => {
    expect(getModelQualityScore('nvidia/nemotron-3-ultra-550b-a55b:free')).toBeGreaterThan(
      getModelQualityScore('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
    )
  })

  it('pushes non-chat models to the bottom so routing never picks one for a conversation', () => {
    expect(getModelQualityScore('BAAI/bge-reranker-v2-m3')).toBeLessThan(10)
    expect(getModelQualityScore('openai/text-embedding-3-large')).toBeLessThan(10)
  })

  it('returns the neutral default for a model it has never heard of', () => {
    expect(getModelQualityScore('some-lab/brand-new-model-v1')).toBe(DEFAULT_MODEL_QUALITY_SCORE)
  })
})
