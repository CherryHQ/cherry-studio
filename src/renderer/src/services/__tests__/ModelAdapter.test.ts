import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import { normalizeGatewayModels, normalizeSdkModels } from '@renderer/services/models/ModelAdapter'
import type { Model, Provider } from '@renderer/types'
import type { EndpointType } from '@renderer/types/index'
import type { SdkModel } from '@renderer/types/sdk'
import { describe, expect, it } from 'vitest'

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  apiKey: 'test-key',
  apiHost: 'https://example.com/v1',
  models: [],
  ...overrides
})

describe('ModelAdapter', () => {
  it('adapts generic SDK models into internal models', () => {
    const provider = createProvider({ id: 'openai' })
    const models = normalizeSdkModels(provider, [
      {
        id: 'gpt-4o-mini',
        display_name: 'GPT-4o mini',
        description: 'General purpose model',
        owned_by: 'openai'
      } as unknown as SdkModel
    ])

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      provider: 'openai',
      group: 'gpt-4o',
      description: 'General purpose model',
      owned_by: 'openai'
    } as Partial<Model>)
  })

  it('preserves supported endpoint types for New API models', () => {
    const provider = createProvider({ id: 'new-api' })
    const endpointTypes: EndpointType[] = ['openai', 'image-generation']
    const [model] = normalizeSdkModels(provider, [
      {
        id: 'new-api-model',
        name: 'New API Model',
        supported_endpoint_types: endpointTypes
      } as unknown as SdkModel
    ])

    expect(model.supported_endpoint_types).toEqual(endpointTypes)
  })

  it('filters unsupported endpoint types while keeping valid ones', () => {
    const provider = createProvider({ id: 'new-api' })
    const [model] = normalizeSdkModels(provider, [
      {
        id: 'another-model',
        name: 'Another Model',
        supported_endpoint_types: ['openai', 'unknown-endpoint', 'gemini']
      } as unknown as SdkModel
    ])

    expect(model.supported_endpoint_types).toEqual(['openai', 'gemini'])
  })

  it('adapts ai-gateway entries through the same adapter', () => {
    const provider = createProvider({ id: 'ai-gateway', type: 'gateway' })
    const [model] = normalizeGatewayModels(provider, [
      {
        id: 'openai/gpt-4o',
        name: 'OpenAI GPT-4o',
        description: 'Gateway entry',
        specification: {
          specificationVersion: 'v2',
          provider: 'openai',
          modelId: 'gpt-4o'
        }
      } as GatewayLanguageModelEntry
    ])

    expect(model).toMatchObject({
      id: 'openai/gpt-4o',
      group: 'openai',
      provider: 'ai-gateway',
      description: 'Gateway entry'
    })
  })

  it('drops invalid entries without ids or names', () => {
    const provider = createProvider()
    const models = normalizeSdkModels(provider, [
      {
        id: '',
        name: ''
      } as unknown as SdkModel
    ])

    expect(models).toHaveLength(0)
  })
})
