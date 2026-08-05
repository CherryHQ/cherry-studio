/**
 * Unit tests for resolveImageTransport — the routing that decides which
 * custom-provider image models run on the job system. ppio / dashscope /
 * modelscope always resolve a poll-capable transport; dmxapi resolves one only
 * for its bespoke families (native gpt-image / dall-e / imagen / gemini-image
 * and the openai-flat fallback stay on the in-SDK path); everything else is
 * null.
 */
import { describe, expect, it } from 'vitest'

import { asConcreteProviderId, asPresetProviderId } from '../../../types'
import { resolveImageTransport } from '../imageTransportRegistry'

describe('resolveImageTransport', () => {
  it('resolves a poll-capable transport for ppio / dashscope / modelscope', () => {
    for (const providerId of ['ppio', 'dashscope', 'modelscope']) {
      const transport = resolveImageTransport(providerId, 'any-model', {})
      expect(transport).not.toBeNull()
      expect(typeof transport?.submit).toBe('function')
      expect(transport?.task.kind).toBe('supported')
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
    const transport = resolveImageTransport(
      'openai-compatible',
      'hy-image-v3.0',
      settings,
      asConcreteProviderId('tokenhub')
    )
    expect(transport).not.toBeNull()
    expect(transport?.task.kind).toBe('supported')
    // non-Hunyuan tokenhub models stay on the in-SDK path
    expect(
      resolveImageTransport('openai-compatible', 'deepseek-v4-pro', settings, asConcreteProviderId('tokenhub'))
    ).toBeNull()
    // other openai-compatible providers are untouched by the concrete-id lookup
    expect(resolveImageTransport('openai-compatible', 'cogview-4', settings, asConcreteProviderId('zhipu'))).toBeNull()
  })

  it('resolves via the preset id, so a duplicated or renamed built-in keeps its transport', () => {
    const copy = asConcreteProviderId('ppio-copy-2')
    expect(resolveImageTransport('openai-compatible', 'qwen-image-txt2img', {}, copy)).toBeNull()
    expect(
      resolveImageTransport('openai-compatible', 'qwen-image-txt2img', {}, copy, asPresetProviderId({ id: 'ppio' }))
    ).not.toBeNull()
  })

  it('prefers the concrete id over the preset id', () => {
    const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
    const tokenhub = asConcreteProviderId('tokenhub')
    const ppioPreset = asPresetProviderId({ id: 'ppio' })
    expect(resolveImageTransport('openai-compatible', 'hy-image-v3.0', settings, tokenhub, ppioPreset)).not.toBeNull()
    expect(resolveImageTransport('openai-compatible', 'deepseek-v4-pro', settings, tokenhub, ppioPreset)).toBeNull()
  })
})
