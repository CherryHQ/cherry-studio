/**
 * Unit tests for resolveImageTransport — the routing that decides which
 * custom-provider image models run on the job system. ppio / dashscope /
 * tokenhub require a registry descriptor, modelscope accepts arbitrary models,
 * and dmxapi resolves only its bespoke families. Everything else is null.
 */
import { describe, expect, it } from 'vitest'

import { hasImageTransport, isImageTransportConfig, resolveImageTransport } from '../imageTransportRegistry'

describe('resolveImageTransport', () => {
  it('requires a registry descriptor for ppio / dashscope / tokenhub', async () => {
    const descriptor = { id: 'any-model', endpoint: '/vendor/task', mode: 'generate' as const }
    for (const providerId of ['ppio', 'dashscope', 'tokenhub'] as const) {
      expect(hasImageTransport(providerId, 'any-model')).toBe(false)
      expect(hasImageTransport(providerId, 'any-model', descriptor)).toBe(true)
      const config = { providerId, providerSettings: { baseURL: 'https://example.invalid', apiKey: 'sk-test' } }
      expect(isImageTransportConfig(config, 'any-model', descriptor)).toBe(true)
      if (!isImageTransportConfig(config, 'any-model', descriptor)) throw new Error('expected transport config')
      const transport = await resolveImageTransport(config, 'any-model', descriptor)
      expect(transport).not.toBeNull()
      expect(typeof transport?.submit).toBe('function')
      expect(transport?.task.kind).toBe('supported')
    }
  })

  it('keeps modelscope available without a registry descriptor', async () => {
    const config = { providerId: 'modelscope' as const, providerSettings: {} }
    expect(hasImageTransport('modelscope', 'any-model')).toBe(true)
    expect(isImageTransportConfig(config, 'any-model')).toBe(true)
    if (!isImageTransportConfig(config, 'any-model')) throw new Error('expected transport config')
    expect(await resolveImageTransport(config, 'any-model')).not.toBeNull()
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
    const descriptor = { id: 'hy-image-v3.0', endpoint: '/v1/images/generations', mode: 'generate' as const }
    const transport = await resolveImageTransport(
      { providerId: 'tokenhub', providerSettings: settings },
      'hy-image-v3.0',
      descriptor
    )
    expect(transport).not.toBeNull()
    expect(transport?.task.kind).toBe('supported')
    expect(hasImageTransport('openai-compatible', 'hy-image-v3.0')).toBe(false)
  })
})
