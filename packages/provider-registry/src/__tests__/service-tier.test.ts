import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'
import { RegistryEndpointConfigSchema } from '../schemas/provider'
import { ProviderModelListSchema, ProviderModelOverrideSchema } from '../schemas/provider-models'
import { getServiceTierCatalogErrors } from '../utils/serviceTierCatalog'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const generatedOverrides = ProviderModelListSchema.parse(
  JSON.parse(readFileSync(join(dataDir, 'provider-models.json'), 'utf8'))
).overrides

const provider = (id: string) => {
  const value = PROVIDERS.find((entry) => entry.id === id)
  if (!value) throw new Error(`Missing provider: ${id}`)
  return value
}

describe('service tier registry contract', () => {
  it('rejects a default outside the supported options and empty model overrides', () => {
    expect(
      RegistryEndpointConfigSchema.safeParse({
        requestControls: {
          serviceTier: {
            default: 'fast',
            options: ['standard', 'flex'],
            wire: {
              delivery: { type: 'provider-option', key: 'serviceTier' },
              values: { standard: 'default', fast: 'priority', flex: 'flex' }
            }
          }
        }
      }).success
    ).toBe(false)

    expect(
      ProviderModelOverrideSchema.safeParse({
        providerId: 'groq',
        modelId: 'gpt-oss-120b',
        requestControls: { serviceTier: { options: [] } }
      }).success
    ).toBe(false)
  })

  it('rejects a model option without an endpoint wire mapping', () => {
    const invalidProvider = {
      ...provider('groq'),
      endpointConfigs: {
        'openai-chat-completions': {
          ...provider('groq').endpointConfigs?.['openai-chat-completions'],
          requestControls: {
            serviceTier: {
              default: 'standard' as const,
              options: ['standard' as const],
              wire: {
                delivery: { type: 'provider-option' as const, key: 'serviceTier' },
                values: { standard: 'on_demand' }
              }
            }
          }
        }
      }
    }
    const invalidOverride = ProviderModelOverrideSchema.parse({
      providerId: 'groq',
      modelId: 'gpt-oss-120b',
      requestControls: { serviceTier: { options: ['standard', 'fast'] } }
    })

    expect(getServiceTierCatalogErrors([invalidProvider], [invalidOverride])).toEqual([
      "groq/gpt-oss-120b@openai-chat-completions: missing wire value for 'fast'"
    ])
  })

  it('projects four Groq tiers only onto the three Performance models', () => {
    const base = provider('groq').endpointConfigs?.['openai-chat-completions']?.requestControls?.serviceTier
    expect(base).toMatchObject({
      default: 'standard',
      options: ['standard', 'auto', 'flex'],
      wire: {
        delivery: { type: 'provider-option', key: 'serviceTier' },
        values: { standard: 'on_demand', auto: 'auto', fast: 'performance', flex: 'flex' }
      }
    })

    const performanceModels = ['gpt-oss-120b', 'gpt-oss-20b', 'llama-3-3-70b-versatile']
    for (const modelId of performanceModels) {
      expect(
        generatedOverrides.find((entry) => entry.providerId === 'groq' && entry.modelId === modelId)?.requestControls
          ?.serviceTier?.options
      ).toEqual(['standard', 'auto', 'fast', 'flex'])
    }
    expect(
      generatedOverrides.find((entry) => entry.providerId === 'groq' && entry.modelId === 'llama-3-1-8b-instant')
        ?.requestControls
    ).toBeUndefined()
  })

  it('declares Standard, Fast, and Flex on both OpenRouter text endpoints', () => {
    const endpoints = provider('openrouter').endpointConfigs
    expect(endpoints?.['openai-chat-completions']?.requestControls?.serviceTier).toMatchObject({
      default: 'standard',
      options: ['standard', 'fast', 'flex'],
      wire: {
        delivery: { type: 'provider-option', key: 'service_tier' },
        values: { standard: 'default', fast: 'priority', flex: 'flex' }
      }
    })
    expect(endpoints?.['anthropic-messages']?.requestControls?.serviceTier).toMatchObject({
      default: 'standard',
      options: ['standard', 'fast', 'flex'],
      wire: {
        delivery: { type: 'request-body', key: 'service_tier' },
        values: { standard: 'default', fast: 'priority', flex: 'flex' }
      }
    })
  })
})
