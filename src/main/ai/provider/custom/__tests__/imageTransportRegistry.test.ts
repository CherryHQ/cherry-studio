/**
 * Unit tests for resolveImageTransport — the routing that decides which
 * custom-provider image models run on the job system. ppio / dashscope /
 * modelscope always resolve a poll-capable transport; dmxapi resolves one only
 * for its bespoke families (native gpt-image / dall-e / imagen / gemini-image
 * and the openai-flat fallback stay on the in-SDK path); everything else is
 * null.
 */
import { describe, expect, it } from 'vitest'

import { resolveImageTransport } from '../imageTransportRegistry'

describe('resolveImageTransport', () => {
  it('resolves a poll-capable transport for ppio / dashscope / modelscope', () => {
    for (const providerId of ['ppio', 'dashscope', 'modelscope']) {
      const transport = resolveImageTransport(providerId, 'any-model', {})
      expect(transport).not.toBeNull()
      expect(typeof transport?.submit).toBe('function')
      expect(typeof transport?.poll).toBe('function')
    }
  })

  it('resolves a transport for dmxapi bespoke families', () => {
    const settings = { baseURL: 'https://www.dmxapi.cn/v1' }
    for (const modelId of ['doubao-seedream-3', 'wan2.2-t2i', 'qwen-image']) {
      expect(resolveImageTransport('dmxapi', modelId, settings)).not.toBeNull()
    }
  })

  it('returns null for dmxapi native / openai-flat models (in-SDK path)', () => {
    const settings = { baseURL: 'https://www.dmxapi.cn/v1' }
    for (const modelId of [
      'gpt-image-1',
      'dall-e-3',
      'imagen-3.0',
      'gemini-2.5-flash-image',
      'some-openai-flat-model'
    ]) {
      expect(resolveImageTransport('dmxapi', modelId, settings)).toBeNull()
    }
  })

  it('returns null for providers without a custom transport', () => {
    expect(resolveImageTransport('openai', 'gpt-image-1', {})).toBeNull()
    expect(resolveImageTransport('unknown-provider', 'x', {})).toBeNull()
  })

  it('resolves tokenhub hy-image via the concrete id (its SDK id is the generic openai-compatible)', () => {
    const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
    const transport = resolveImageTransport('openai-compatible', 'hy-image-v3.0', settings, 'tokenhub')
    expect(transport).not.toBeNull()
    expect(typeof transport?.poll).toBe('function')
    // non-Hunyuan tokenhub models stay on the in-SDK path
    expect(resolveImageTransport('openai-compatible', 'deepseek-v4-pro', settings, 'tokenhub')).toBeNull()
    // other openai-compatible providers are untouched by the concrete-id lookup
    expect(resolveImageTransport('openai-compatible', 'cogview-4', settings, 'zhipu')).toBeNull()
  })

  it('resolves via the preset id, so a duplicated or renamed built-in keeps its transport', () => {
    // Duplicating PPIO in Settings gives the copy a fresh `Provider.id` while
    // `presetProviderId` still says `ppio`. Keyed only on the concrete id, the copy
    // found no transport and fell through to the generic OpenAI-compatible image
    // model — POSTing `/images/generations` to a vendor whose images are submit/poll.
    expect(resolveImageTransport('openai-compatible', 'qwen-image-txt2img', {}, 'ppio-copy-2')).toBeNull()
    expect(resolveImageTransport('openai-compatible', 'qwen-image-txt2img', {}, 'ppio-copy-2', 'ppio')).not.toBeNull()
  })

  it('prefers the concrete id over the preset id', () => {
    // A concrete-id row must win: tokenhub rides the openai-compatible SDK id, so a
    // preset fallback that overrode it would mis-route the vendor-specific models.
    const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
    expect(resolveImageTransport('openai-compatible', 'hy-image-v3.0', settings, 'tokenhub', 'ppio')).not.toBeNull()
    expect(resolveImageTransport('openai-compatible', 'deepseek-v4-pro', settings, 'tokenhub', 'ppio')).toBeNull()
  })
})
