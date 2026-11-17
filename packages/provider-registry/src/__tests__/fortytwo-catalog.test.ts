import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RegistryLoader } from '../registry-loader'

const data = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const registry = new RegistryLoader({
  models: join(data, 'models.json'),
  providers: join(data, 'providers.json'),
  providerModels: join(data, 'provider-models.json')
})

describe('Fortytwo serving contract', () => {
  it('has a translated proper-name label in every current renderer locale', () => {
    const directory = join(data, '../../..', 'src/renderer/i18n/locales')
    const locales = readdirSync(directory).filter((name) => name.endsWith('.json'))
    expect(locales).toContain('en-us.json')
    for (const locale of locales) {
      expect(JSON.parse(readFileSync(join(directory, locale), 'utf8'))['provider.fortytwo'], locale).toBe('Fortytwo')
    }
  })

  it('offers one authenticated global-only Chat Completions connection', () => {
    const provider = registry.findProvider('fortytwo')!
    expect(provider.name).toBe('Fortytwo')
    expect(provider.availableInEditions).toEqual(['global'])
    expect(provider.authOptional).not.toBe(true)
    expect(provider.defaultChatEndpoint).toBe('openai-chat-completions')
    expect(Object.keys(provider.endpointConfigs ?? {})).toEqual(['openai-chat-completions'])
    expect(provider.endpointConfigs?.['openai-chat-completions']).toMatchObject({
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.fortytwo.network/v1',
      reasoningFormat: { type: 'openai-chat' }
    })
    const offers = registry.getOverridesForProvider('fortytwo')
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({ modelId: 'qwen3-8-27b', apiModelId: 'qwen/qwen3.8-27b' })
  })

  it('replaces unsupported canonical metadata without changing the canonical model', () => {
    const override = registry.findOverride('fortytwo', 'qwen3-8-27b')!
    expect(override.capabilities?.force).toEqual([
      'function-call',
      'reasoning',
      'image-recognition',
      'structured-output'
    ])
    expect(override.inputModalities).toEqual(['text', 'image'])
    expect(override.outputModalities).toEqual(['text'])
    expect(override.endpointTypes).toEqual(['openai-chat-completions'])
    expect(override.limits).toEqual({ contextWindow: 262144, maxOutputTokens: 235929 })
    expect(override.pricing).toEqual({
      input: { currency: 'USD', perMillionTokens: 0.425 },
      output: { currency: 'USD', perMillionTokens: 2.55 },
      cacheRead: { currency: 'USD', perMillionTokens: 0.085 },
      cacheWrite: { currency: 'USD', perMillionTokens: 0 },
      inputTokenTiers: []
    })
    expect(registry.findModel('qwen3-8-27b')).toMatchObject({
      contextWindow: 1000000,
      maxOutputTokens: 131072,
      pricing: { cacheWrite: { perMillionTokens: 0.625 } }
    })
  })

  it('advertises the API effort vocabulary without inherited budget controls', () => {
    expect(
      registry.findOverride('fortytwo', 'qwen3-8-27b')?.reasoningContracts?.['openai-chat-completions']?.support
    ).toEqual({
      controls: [{ kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }]
    })
  })
})
