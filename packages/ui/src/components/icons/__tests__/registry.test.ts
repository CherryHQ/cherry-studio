import { describe, expect, it } from 'vitest'

import { resolveIconRef, resolveModelIconRef, resolveModelToProviderIconRef, resolveProviderIconRef } from '../registry'

describe('resolveProviderIconRef', () => {
  it('resolves the Rapid-MLX provider icon', () => {
    expect(resolveProviderIconRef('rapid-mlx')).toEqual(expect.objectContaining({ kind: 'provider', key: 'rapid-mlx' }))
  })

  it('resolves the ModelRush provider icon', () => {
    expect(resolveProviderIconRef('modelrush')).toEqual(expect.objectContaining({ kind: 'provider', key: 'modelrush' }))
  })

  it('falls back to the model catalog for provider IDs that only exist there', () => {
    // `claude` is a model-catalog key with no provider-catalog entry
    expect(resolveProviderIconRef('claude')).toEqual(expect.objectContaining({ kind: 'model', key: 'claude' }))
  })

  it('returns undefined for unknown provider IDs', () => {
    expect(resolveProviderIconRef('definitely-not-a-provider')).toBeUndefined()
    expect(resolveProviderIconRef('')).toBeUndefined()
  })
})

describe('resolveModelIconRef — pattern boundaries (#10, #11, #12)', () => {
  it('sensenova is not preempted by the broader nova pattern (#10)', () => {
    expect(resolveModelIconRef('sensenova-v6')?.key).toBe('sensenova')
    expect(resolveModelIconRef('nova-pro')?.key).toBe('nova')
  })

  it('ling/ring only match as delimited tokens (#11)', () => {
    expect(resolveModelIconRef('ling-1t')?.key).toBe('ling')
    expect(resolveModelIconRef('spring-1t')?.key).not.toBe('ling')
    expect(resolveModelIconRef('ringo-v1')?.key).not.toBe('ling')
    expect(resolveModelIconRef('bge-multilingual-embedding')?.key).not.toBe('ling')
  })

  it('wan is delimiter-bounded; bare/dashed sora resolves (#12)', () => {
    expect(resolveModelIconRef('wan-2-1')?.key).toBe('qwen')
    expect(resolveModelIconRef('taiwan-llm')?.key).not.toBe('qwen')
    expect(resolveModelIconRef('sora')?.key).toBe('sora')
    expect(resolveModelIconRef('sora-2')?.key).toBe('sora')
  })
})

describe('resolveModelIconRef — dedicated model marks', () => {
  it('keeps broad family names token-bounded', () => {
    expect(resolveModelIconRef('metadata-embedding')?.key).not.toBe('meta')
    expect(resolveModelIconRef('influxdb-query')?.key).not.toBe('flux')
    expect(resolveModelIconRef('sonarqube-code')?.key).not.toBe('perplexity')
    expect(resolveModelIconRef('sparkling-image')?.key).not.toBe('kling')
    expect(resolveModelIconRef('k3po')?.key).not.toBe('kimi')
  })
})

describe('vendor-pattern parity with VENDOR_PATTERNS (icon routing drift)', () => {
  it('bare ByteDance seed ids route to the Doubao icon (delimiter-bounded)', () => {
    expect(resolveModelIconRef('seed-2.0-lite')?.key).toBe('doubao')
    expect(resolveModelIconRef('seed-1.6-flash')?.key).toBe('doubao')
    expect(resolveModelIconRef('seedream-4-5')?.key).toBe('doubao')
    expect(resolveModelIconRef('seedance-1-0')?.key).toBe('doubao')
    // guard: `seed` embedded in another word must not misfire
    expect(resolveModelIconRef('linseed-embedding')?.key).not.toBe('doubao')
  })

  it('Hunyuan hy-* and hyN ids route to the Hunyuan icon without matching embedded fragments', () => {
    expect(resolveModelIconRef('hy-role')?.key).toBe('hunyuan')
    expect(resolveModelIconRef('hy-mt2-pro')?.key).toBe('hunyuan')
    expect(resolveModelIconRef('hy-image-v3-0')?.key).toBe('hunyuan')
    expect(resolveModelIconRef('hy3-preview')?.key).toBe('hunyuan')
    expect(resolveModelIconRef('myhy3-model')?.key).not.toBe('hunyuan')
    expect(resolveModelIconRef('hybrid-model')?.key).not.toBe('hunyuan')
  })

  it('bare/namespaced o-series ids route to the OpenAI provider icon', () => {
    expect(resolveIconRef('openai/o3', 'openrouter')).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'openai' })
    )
    expect(resolveModelToProviderIconRef('o3')?.key).toBe('openai')
    expect(resolveModelToProviderIconRef('o1')?.key).toBe('openai')
    expect(resolveModelToProviderIconRef('o3-mini')?.key).toBe('openai')
    // guard: not matched inside another word
    expect(resolveModelToProviderIconRef('mano3')?.key).not.toBe('openai')
  })
})

describe('resolveIconRef — full fallback chain', () => {
  it('falls back to the provider id', () => {
    expect(resolveIconRef('some-unmatched-model', 'openai')).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'openai' })
    )
  })
})

// New OpenAI model IDs must resolve to their own artwork instead of an older family fallback.
describe('latest OpenAI model artwork', () => {
  it.each([
    ['gpt-6.1-sol', 'gpt-6-1-sol'],
    ['gpt-6.1-terra', 'gpt-6-1-terra'],
    ['gpt-6-luna', 'gpt-6-luna'],
    ['gpt-6-sol', 'gpt-6-sol'],
    ['gpt-6-cyber', 'gpt-6-cyber'],
    ['gpt-5.6-cyber', 'gpt-5-6-cyber'],
    ['gpt-image-2.6-sunburst', 'gpt-image-2-6-sunburst'],
    ['gpt-image-2.6-flare', 'gpt-image-2-6-flare'],
    ['gpt-image-2.5-sunburst', 'gpt-image-2-5-sunburst'],
    ['gpt-image-2.5-flare', 'gpt-image-2-5-flare'],
    ['gpt-live-1', 'gpt-live-1'],
    ['gpt-live-transcribe', 'gpt-live-transcribe'],
    ['gpt-transcribe', 'gpt-transcribe'],
    ['gpt-rosalind-research', 'gpt-rosalind-research'],
    ['chat-latest', 'chat-latest'],
    ['chatgpt-image-latest', 'chatgpt-image-latest'],
    ['gpt-daybreak-red-latest', 'gpt-daybreak-red-latest'],
    ['gpt-daybreak-blue-latest', 'gpt-daybreak-blue-latest']
  ])('resolves %s without falling back to unrelated artwork', (modelId, key) => {
    for (const id of [modelId, modelId.replaceAll('.', '-'), `openai/${modelId}`]) {
      expect(resolveIconRef(id, 'openai')).toEqual(expect.objectContaining({ kind: 'model', key }))
    }
  })
})
