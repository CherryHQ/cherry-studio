/**
 * Unit tests for normalizeModelId and its sub-steps.
 * Pure functions — no mocking required.
 */

import { describe, expect, it } from 'vitest'

import {
  expandKnownPrefixes,
  normalizeModelId,
  normalizeVersionSeparators,
  stripBedrockRevision,
  stripBedrockVendorPrefix,
  stripDateSnapshot,
  stripQuantization
} from '../utils/normalize'

describe('stripQuantization', () => {
  it('strips a trailing quantization marker', () => {
    expect(stripQuantization('glm-4-5-fp8')).toBe('glm-4-5')
    expect(stripQuantization('llama-3-3-instruct-bf16')).toBe('llama-3-3-instruct')
    expect(stripQuantization('qwen3-a22b-int4')).toBe('qwen3-a22b')
  })

  it('leaves non-quantized ids untouched', () => {
    expect(stripQuantization('gpt-4o')).toBe('gpt-4o')
    expect(stripQuantization('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })
})

describe('stripDateSnapshot', () => {
  it('strips unambiguous trailing date stamps', () => {
    expect(stripDateSnapshot('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
    expect(stripDateSnapshot('gpt-4o-2024-08-06')).toBe('gpt-4o')
    expect(stripDateSnapshot('kimi-k2-250905')).toBe('kimi-k2')
  })

  it('does NOT strip sizes, versions, or ambiguous 4-digit stamps', () => {
    expect(stripDateSnapshot('glm-4-9b')).toBe('glm-4-9b')
    expect(stripDateSnapshot('qwen3-235b')).toBe('qwen3-235b')
    expect(stripDateSnapshot('deepseek-v3-0324')).toBe('deepseek-v3-0324') // MMDD — reconciler's job
    expect(stripDateSnapshot('qwen3-a22b-instruct-2507')).toBe('qwen3-a22b-instruct-2507') // YYMM
    expect(stripDateSnapshot('gpt-4-0125-preview')).toBe('gpt-4-0125-preview')
  })

  it('does NOT strip a 6/8-digit suffix with an invalid month/day', () => {
    expect(stripDateSnapshot('foo-202413')).toBe('foo-202413') // month 24/13 invalid
    expect(stripDateSnapshot('foo-250001')).toBe('foo-250001') // month 00 invalid
  })
})

describe('normalizeVersionSeparators', () => {
  it('treats _ , . p between digits as version separators', () => {
    expect(normalizeVersionSeparators('glm-4_5')).toBe('glm-4-5')
    expect(normalizeVersionSeparators('claude-3.5-sonnet')).toBe('claude-3-5-sonnet')
    expect(normalizeVersionSeparators('deepseek-v3_1')).toBe('deepseek-v3-1')
  })

  it('only fires between digits', () => {
    expect(normalizeVersionSeparators('gpt_oss')).toBe('gpt_oss')
  })
})

describe('stripBedrockVendorPrefix', () => {
  it('strips a region(s)+vendor dotted prefix from a bedrock arn', () => {
    expect(stripBedrockVendorPrefix('us.anthropic.claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(stripBedrockVendorPrefix('global.meta.llama4-scout')).toBe('llama4-scout')
    expect(stripBedrockVendorPrefix('anthropic.claude-3-5-haiku')).toBe('claude-3-5-haiku')
  })

  it('strips a vendor dash prefix', () => {
    expect(stripBedrockVendorPrefix('meta-llama-3-70b')).toBe('llama-3-70b')
    expect(stripBedrockVendorPrefix('cohere-command-r')).toBe('command-r')
  })

  it('leaves a version like qwen3.7 untouched (dotted word is not all-alpha)', () => {
    expect(stripBedrockVendorPrefix('qwen3.7')).toBe('qwen3.7')
  })
})

describe('stripBedrockRevision', () => {
  it('strips a bedrock arn model revision', () => {
    expect(stripBedrockRevision('claude-sonnet-4-5-v1:0')).toBe('claude-sonnet-4-5')
    expect(stripBedrockRevision('claude-3-5-haiku:0')).toBe('claude-3-5-haiku')
  })

  it('leaves a real version suffix without a colon untouched', () => {
    expect(stripBedrockRevision('whisper-large-v3')).toBe('whisper-large-v3')
  })
})

describe('expandKnownPrefixes', () => {
  it('expands the minimax shorthand (no aggregator-prefix strip swallows mm-)', () => {
    expect(expandKnownPrefixes('mm-m2-1')).toBe('minimax-m2-1')
  })
})

describe('normalizeModelId — spelling variants collapse to one canonical', () => {
  it('folds a bedrock cross-vendor arn to the bare canonical id', () => {
    expect(normalizeModelId('us.anthropic.claude-sonnet-4-5-v1:0')).toBe(normalizeModelId('claude-sonnet-4-5'))
    expect(normalizeModelId('anthropic.claude-3-5-haiku-20241022:0')).toBe(normalizeModelId('claude-3-5-haiku'))
  })

  it('expands mm- → minimax- (the aggregator-prefix pass no longer swallows it)', () => {
    expect(normalizeModelId('mm-m2-1')).toBe('minimax-m2-1')
  })

  it('quantization + underscore + base all normalize to the same id', () => {
    const canonical = normalizeModelId('glm-4-5')
    expect(normalizeModelId('glm-4-5-fp8')).toBe(canonical)
    expect(normalizeModelId('glm-4_5')).toBe(canonical)
  })

  it('folds non-version underscores so HF-style ids resolve (mirrors the catalog)', () => {
    // `bce-embedding-base_v1` (served by netease-youdao/maidalun) must match the dash-only base id.
    expect(normalizeModelId('netease-youdao/bce-embedding-base_v1')).toBe('bce-embedding-base-v1')
    expect(normalizeModelId('maidalun1020/bce-reranker-base_v1')).toBe('bce-reranker-base-v1')
  })

  it('llama instruct quantization/separator spellings collapse', () => {
    const canonical = normalizeModelId('llama-3-3-instruct')
    expect(normalizeModelId('llama-3-3-instruct-fp8')).toBe(canonical)
    expect(normalizeModelId('llama-3_3-instruct')).toBe(canonical)
  })

  it('does NOT collapse host-marker -maas (can carry a size/price distinction)', () => {
    expect(normalizeModelId('gpt-oss-maas')).not.toBe(normalizeModelId('gpt-oss'))
  })

  it('collapses dated snapshots of a line to one bare canonical', () => {
    const canonical = normalizeModelId('hunyuan-turbos')
    expect(normalizeModelId('hunyuan-turbos-20250226')).toBe(canonical)
    expect(normalizeModelId('hunyuan-turbos-20250716')).toBe(canonical)
    expect(normalizeModelId('claude-sonnet-4-5-20250929')).toBe(normalizeModelId('claude-sonnet-4-5'))
  })
})
