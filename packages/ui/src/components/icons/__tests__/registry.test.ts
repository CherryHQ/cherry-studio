import { describe, expect, it } from 'vitest'

import { resolveIconRef, resolveModelIconRef, resolveModelToProviderIconRef, resolveProviderIconRef } from '../registry'

describe('resolveProviderIconRef', () => {
  const testCases = [
    { providerId: 'claude-code', expectedToExist: true },
    { providerId: 'github-copilot-openai-compatible', expectedToExist: true },
    { providerId: 'copilot', expectedToExist: true },
    { providerId: 'yi', expectedToExist: true },
    { providerId: 'zai', expectedToExist: true },
    { providerId: 'tencent-cloud-ti', expectedToExist: true },
    { providerId: 'tokenhub', expectedToExist: true },
    { providerId: 'baidu-cloud', expectedToExist: true },
    { providerId: 'aws-bedrock', expectedToExist: true },
    { providerId: 'aionly', expectedToExist: true },
    { providerId: 'gitee-ai', expectedToExist: true }
  ]

  for (const { providerId, expectedToExist } of testCases) {
    it(`should resolve icon ref for providerId: "${providerId}"`, () => {
      const ref = resolveProviderIconRef(providerId)
      if (expectedToExist) {
        expect(ref).toBeDefined()
        expect(ref?.meta.id).toBeTruthy()
      } else {
        expect(ref).toBeUndefined()
      }
    })
  }

  it('falls back to the model catalog for provider IDs that only exist there', () => {
    // `claude` is a model-catalog key with no provider-catalog entry
    expect(resolveProviderIconRef('claude')).toEqual(expect.objectContaining({ kind: 'model', key: 'claude' }))
  })

  it('returns undefined for unknown provider IDs', () => {
    expect(resolveProviderIconRef('definitely-not-a-provider')).toBeUndefined()
    expect(resolveProviderIconRef('')).toBeUndefined()
  })
})

describe('resolveModelToProviderIconRef', () => {
  const testCases = [
    { modelId: 'yi-34b', expectedToExist: true },
    { modelId: 'arcee-virtuoso', expectedToExist: true },
    { modelId: 'dolphin-mixtral', expectedToExist: true },
    { modelId: 'bce-embedding', expectedToExist: true },
    { modelId: 'runway-gen3', expectedToExist: true }
  ]

  for (const { modelId, expectedToExist } of testCases) {
    it(`should resolve provider icon ref for modelId: "${modelId}"`, () => {
      const ref = resolveModelToProviderIconRef(modelId)
      if (expectedToExist) {
        expect(ref).toBeDefined()
        expect(ref?.kind).toBe('provider')
      } else {
        expect(ref).toBeUndefined()
      }
    })
  }
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
  const gptCases = [
    ['openai/gpt-5.6-luna-pro', 'gpt-5-6-luna'],
    ['gpt-5.5-pro', 'gpt-5-5-pro'],
    ['gpt-5.4-mini', 'gpt-5-4-mini'],
    ['gpt-5.3-codex-spark', 'gpt-5-3-codex'],
    ['gpt-5.2-chat-latest', 'gpt-5-2-chat-latest'],
    ['gpt-5.1-codex-max', 'gpt-5-1-codex-max'],
    ['gpt-4o-mini-search-preview', 'gpt-4o-mini-search-preview'],
    ['gpt-4.1-nano', 'gpt-4-1-nano'],
    ['gpt-4-turbo-preview', 'gpt-4-turbo-preview'],
    ['gpt-3.5-turbo', 'gpt-3-5-turbo'],
    ['gpt-image-2', 'gpt-image-2'],
    ['gpt-image-1-mini', 'gpt-image-1-mini'],
    ['gpt-audio-mini', 'gpt-audio-mini'],
    ['gpt-realtime-2.1', 'gpt-realtime-2-1'],
    ['dall-e-3', 'dalle']
  ] as const

  it.each(gptCases)('routes %s to %s', (modelId, key) => {
    expect(resolveModelIconRef(modelId)?.key).toBe(key)
  })

  const familyCases = [
    ['google/nano-banana-pro', 'nanobanana'],
    ['deepseek-v4-pro', 'deepseek'],
    ['meta/llama-3.3-70b', 'meta'],
    ['nousresearch/hermes-4-405b', 'nousresearch'],
    ['mistral/mixtral-8x22b', 'mistral'],
    ['minimax-m2.1', 'minimax'],
    ['ai21-labs/jamba-1.5-large', 'ai21'],
    ['c4ai-aya-expanse-32b', 'aya'],
    ['cohere/command-r-plus', 'cohere'],
    ['nvidia/nemotron-3-super', 'nvidia'],
    ['voyage-3.5', 'voyage'],
    ['upstage/solar-pro-3', 'upstage'],
    ['baai/bge-m3', 'baai'],
    ['deepcogito/cogito-v2.1-671b', 'deepcogito'],
    ['inception/mercury-2', 'inception'],
    ['relace/relace-search', 'relace'],
    ['jina-embeddings-v3', 'jina'],
    ['perplexity/sonar-pro', 'perplexity'],
    ['black-forest-labs/flux.1-dev', 'flux'],
    ['ideogram-v3', 'ideogram'],
    ['stable-diffusion-xl', 'stability'],
    ['kling-v2.1', 'kling'],
    ['kwai-kolors', 'kolors'],
    ['suno-v4.5', 'suno'],
    ['longcat-flash-chat', 'longcat'],
    ['chatglm-4-air', 'chatglm'],
    ['cogview-4', 'cogview'],
    ['glm-4.6v-flash', 'glmv'],
    ['baichuan-4', 'baichuan'],
    ['internvl-3', 'internlm'],
    ['01-ai/yi-large', 'yi'],
    ['baidu/ernie-4.5', 'wenxin'],
    ['stepfun/step-3.5-flash', 'stepfun']
  ] as const

  it.each(familyCases)('routes %s to %s', (modelId, key) => {
    expect(resolveModelIconRef(modelId)?.key).toBe(key)
  })

  it('keeps broad family names token-bounded', () => {
    expect(resolveModelIconRef('metadata-embedding')?.key).not.toBe('meta')
    expect(resolveModelIconRef('influxdb-query')?.key).not.toBe('flux')
    expect(resolveModelIconRef('sonarqube-code')?.key).not.toBe('perplexity')
    expect(resolveModelIconRef('sparkling-image')?.key).not.toBe('kling')
  })
})

describe('vendor-pattern parity with VENDOR_PATTERNS (icon routing drift)', () => {
  it('lyria routes to the Gemini model icon (namespaced OpenRouter id)', () => {
    expect(resolveModelIconRef('google/lyria-3-pro-preview')?.key).toBe('gemini')
  })

  it('happyhorse-* video ids route to the happyhorse model icon', () => {
    expect(resolveModelIconRef('happyhorse-1.1-i2v')?.key).toBe('happyhorse')
    expect(resolveModelIconRef('happyhorse-1.0-video-edit')?.key).toBe('happyhorse')
  })

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

  it('uses dedicated GPT media icons and keeps unknown GPT families on the OpenAI provider icon', () => {
    expect(resolveIconRef('gpt-audio', 'openrouter')).toEqual(
      expect.objectContaining({ kind: 'model', key: 'gpt-audio' })
    )
    expect(resolveIconRef('gpt-realtime-2.1', 'openrouter')).toEqual(
      expect.objectContaining({ kind: 'model', key: 'gpt-realtime-2-1' })
    )
    expect(resolveIconRef('gpt-chat-latest', 'openrouter')).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'openai' })
    )
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
  it('prefers the dedicated model icon', () => {
    expect(resolveIconRef('claude-sonnet-5', 'openrouter')).toEqual(
      expect.objectContaining({ kind: 'model', key: 'claude' })
    )
  })

  it('prefers a dedicated family model icon over its provider icon', () => {
    expect(resolveIconRef('deepseek-chat', 'unknown-provider')).toEqual(
      expect.objectContaining({ kind: 'model', key: 'deepseek' })
    )
  })

  it('falls back to the provider id', () => {
    expect(resolveIconRef('some-unmatched-model', 'openai')).toEqual(
      expect.objectContaining({ kind: 'provider', key: 'openai' })
    )
  })

  it('carries the icon meta on the ref', () => {
    const ref = resolveIconRef('some-unmatched-model', 'openai')
    expect(ref?.meta).toEqual(expect.objectContaining({ id: 'openai', colorPrimary: expect.any(String) }))
  })
})
