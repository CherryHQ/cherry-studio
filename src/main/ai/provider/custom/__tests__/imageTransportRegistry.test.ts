/**
 * Unit tests for resolveImageTransport — the routing that decides which
 * custom-provider image models run on the job system. ppio / dashscope /
 * modelscope always resolve a poll-capable transport; dmxapi resolves one only
 * for its bespoke families (native gpt-image / dall-e / imagen / gemini-image
 * and the openai-flat fallback stay on the in-SDK path); everything else is
 * null.
 */
import { describe, expect, it } from 'vitest'

import { hasImageTransport, isImageTransportConfig, resolveImageTransport } from '../imageTransportRegistry'

describe('resolveImageTransport', () => {
  it('resolves a poll-capable transport for ppio / dashscope / modelscope', async () => {
    for (const providerId of ['ppio', 'dashscope', 'modelscope'] as const) {
      expect(hasImageTransport(providerId, 'any-model')).toBe(true)
      const config = { providerId, providerSettings: {} }
      expect(isImageTransportConfig(config, 'any-model')).toBe(true)
      if (!isImageTransportConfig(config, 'any-model')) throw new Error('expected transport config')
      const transport = await resolveImageTransport(config, 'any-model')
      expect(transport).not.toBeNull()
      expect(typeof transport?.submit).toBe('function')
      expect(transport?.task.kind).toBe('supported')
    }
  })

  it('resolves a transport for dmxapi bespoke families', async () => {
    const settings = { baseURL: 'https://www.dmxapi.cn/v1' }
    for (const modelId of ['doubao-seedream-3', 'wan2.2-t2i', 'qwen-image']) {
      expect(hasImageTransport('dmxapi', modelId)).toBe(true)
      expect(await resolveImageTransport({ providerId: 'dmxapi', providerSettings: settings }, modelId)).not.toBeNull()
    }
  })

  it('returns null for dmxapi native / openai-flat models (in-SDK path)', async () => {
    const settings = { baseURL: 'https://www.dmxapi.cn/v1' }
    for (const modelId of [
      'gpt-image-1',
      'dall-e-3',
      'imagen-3.0',
      'gemini-2.5-flash-image',
      'some-openai-flat-model'
    ]) {
      expect(hasImageTransport('dmxapi', modelId)).toBe(false)
      expect(await resolveImageTransport({ providerId: 'dmxapi', providerSettings: settings }, modelId)).toBeNull()
    }
  })

  it('returns null for providers without a custom transport', async () => {
    expect(hasImageTransport('openai', 'gpt-image-1')).toBe(false)
    expect(hasImageTransport('unknown-provider', 'x')).toBe(false)
  })

  it('resolves tokenhub models by the provider id', async () => {
    const settings = { apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com/v1' }
    const transport = await resolveImageTransport(
      { providerId: 'tokenhub', providerSettings: settings },
      'hy-image-v3.0'
    )
    expect(transport).not.toBeNull()
    expect(transport?.task.kind).toBe('supported')
    expect(hasImageTransport('openai-compatible', 'hy-image-v3.0')).toBe(false)
  })
})
