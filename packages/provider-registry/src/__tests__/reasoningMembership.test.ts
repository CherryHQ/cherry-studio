import { describe, expect, it } from 'vitest'

import { inferReasoningMembership } from '../patterns/reasoning-heuristics'

/**
 * Characterization matrix for the reasoning MEMBERSHIP gate (#16598) —
 * moved from `src/shared/utils/__tests__/model.test.ts` when the gate's
 * knowledge became creator data (`Creator.reasoningMembership` +
 * `reasoning-membership.gen.ts`).
 */
describe('inferReasoningMembership', () => {
  it.each([
    // Legacy matrix (verbatim behavior of inferReasoningFromModelId)
    'claude-3.7-sonnet',
    'claude-sonnet-4-5',
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
    'gpt-5.1',
    'gpt-oss',
    'o3-mini',
    'qwen-plus',
    'qwen3.5-plus',
    'deepseek-r1',
    'hunyuan-a13b',
    'kimi-k2.5',
    // Deliberate coverage extensions: new-generation SKUs the knob rules
    // already cover, plus the canonical-hyphen catalog spellings.
    'claude-sonnet-5',
    'claude-opus-latest',
    'claude-fable',
    'doubao-seed-2.1',
    'glm-4-5',
    'glm-4-7-flash',
    'kimi-k2-5',
    'mimo-v2-5'
  ])('claims %s', (modelId) => {
    expect(inferReasoningMembership(modelId)).toBe(true)
  })

  it.each([
    'gpt-5.1-chat',
    'gemini-3-flash-image',
    'text-embedding-3-small',
    'bge-reranker-v2',
    'qwen2.5-72b-instruct',
    'qwen3-coder',
    'grok-4-fast-non-reasoning',
    'claude-3-5-sonnet',
    'hunyuan-lite',
    'gpt-4o'
  ])('does not claim %s', (modelId) => {
    expect(inferReasoningMembership(modelId)).toBe(false)
  })

  it('normalizes namespaces and listing suffixes like the legacy gate', () => {
    expect(inferReasoningMembership('deepseek/deepseek-r1:free')).toBe(true)
    expect(inferReasoningMembership('accounts/fireworks/models/deepseek-r1')).toBe(true)
    expect(inferReasoningMembership('qwen/qwen3-32b(free)')).toBe(true)
  })
})
