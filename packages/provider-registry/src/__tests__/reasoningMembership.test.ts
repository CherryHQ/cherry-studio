import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inferReasoningMembership } from '../patterns/reasoning-heuristics'

/**
 * Characterization matrix for the reasoning MEMBERSHIP gate (#16598) —
 * moved from `src/shared/utils/__tests__/model.test.ts` when the gate's
 * knowledge became creator data. Membership is implied by the PROFILE rules
 * of `Creator.reasoningFamilies` (template rules contribute knobs only).
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
    'mimo-v2-5',
    // Gemini image SKUs ship thinking budgets (catalog: gemini-2-5-flash-image, 3-1-flash-image).
    'gemini-3-flash-image'
  ])('claims %s', (modelId) => {
    expect(inferReasoningMembership(modelId)).toBe(true)
  })

  it.each([
    'gpt-5.1-chat',
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

  it('claims every catalog model that ships reasoning controls', () => {
    // Invariant: an official-catalog reasoning model must pass the gate, or a
    // user adding the same id on a custom provider silently gets no
    // descriptor (the knob rules become unreachable). No exemptions — fix a
    // failure by adding a membership profile rule to the owning creator.
    const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
    const models = JSON.parse(readFileSync(join(dataDir, 'models.json'), 'utf8')).models as Array<{
      id: string
      reasoning?: { controls?: unknown[] }
    }>
    // Reviewed upstream mislabels: models.dev grants these controls, but the
    // vendor documents the SKU as non-thinking (or the knob is a fixed no-op).
    // A custom-provider row for these ids correctly gets no descriptor. Every
    // entry must still be a live gap — remove it here once upstream corrects.
    const KNOWN_UPSTREAM_MISLABELS = new Set([
      'qwen3-coder', // Qwen3-Coder: officially no thinking mode
      'qwen3-coder-30b-a3b',
      'qwen3-coder-next',
      'qwen3-235b-a22b-instruct-2507-maas', // instruct = non-thinking hybrid variant
      'gpt-5-1-chat-latest', // chat SKUs pinned to a single fixed effort — nothing to control
      'gpt-5-2-chat-latest'
    ])
    const gaps = models
      .filter((m) => (m.reasoning?.controls?.length ?? 0) > 0 && !inferReasoningMembership(m.id))
      .map((m) => m.id)
    expect(gaps.filter((id) => !KNOWN_UPSTREAM_MISLABELS.has(id))).toEqual([])
    // Stale-exemption guard: every listed mislabel must still be a real gap.
    expect([...KNOWN_UPSTREAM_MISLABELS].filter((id) => !gaps.includes(id))).toEqual([])
  })
})
