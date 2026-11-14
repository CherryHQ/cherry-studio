import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'
import { RegistryEndpointConfigSchema } from '../schemas/provider'
import { ProviderModelOverrideSchema } from '../schemas/provider-models'
import { getServiceTierCatalogErrors } from '../utils/serviceTierCatalog'

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
})
