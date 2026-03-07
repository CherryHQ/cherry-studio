import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { ModelCatalogSchema, ModelConfigSchema } from '../gen/v1/model_pb'
import { ProviderModelCatalogSchema } from '../gen/v1/provider_models_pb'
import { ProviderCatalogSchema, ProviderConfigSchema } from '../gen/v1/provider_pb'

describe('protobuf roundtrip', () => {
  it('ModelCatalog roundtrips through binary', () => {
    const catalog = create(ModelCatalogSchema, {
      version: '2026-03-06',
      models: [
        create(ModelConfigSchema, {
          id: 'claude-3-5-sonnet',
          name: 'Claude 3.5 Sonnet',
          contextWindow: 200000,
          maxOutputTokens: 4096
        })
      ]
    })

    const bytes = toBinary(ModelCatalogSchema, catalog)
    const decoded = fromBinary(ModelCatalogSchema, bytes)

    expect(decoded.version).toBe('2026-03-06')
    expect(decoded.models).toHaveLength(1)
    expect(decoded.models[0].id).toBe('claude-3-5-sonnet')
    expect(decoded.models[0].contextWindow).toBe(200000)
  })

  it('ProviderCatalog roundtrips through binary', () => {
    const catalog = create(ProviderCatalogSchema, {
      version: '2026-03-06',
      providers: [
        create(ProviderConfigSchema, {
          id: 'openai',
          name: 'OpenAI'
        })
      ]
    })

    const bytes = toBinary(ProviderCatalogSchema, catalog)
    const decoded = fromBinary(ProviderCatalogSchema, bytes)

    expect(decoded.providers[0].id).toBe('openai')
  })

  it('ProviderModelCatalog roundtrips through binary', () => {
    const catalog = create(ProviderModelCatalogSchema, {
      version: '2026-03-06',
      overrides: []
    })

    const bytes = toBinary(ProviderModelCatalogSchema, catalog)
    const decoded = fromBinary(ProviderModelCatalogSchema, bytes)

    expect(decoded.version).toBe('2026-03-06')
    expect(decoded.overrides).toHaveLength(0)
  })
})
