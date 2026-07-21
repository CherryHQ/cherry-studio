import { getAiSdkProviderId } from '@renderer/aiCore/provider/factory'
import type { Model, Provider } from '@renderer/types'
import { formatApiHost } from '@shared/utils'
import { describe, expect, it } from 'vitest'

import { buildApiCheckProvider, getApiCheckModels } from '../providerCheck'

const makeModel = (id: string): Model => ({
  id,
  provider: 'zhipu',
  name: id,
  group: 'BigModel'
})

const makeProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'zhipu',
  type: 'openai',
  name: 'ZhiPu',
  apiKey: 'stored-key',
  apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
  anthropicApiHost: 'https://open.bigmodel.cn/api/anthropic',
  models: [],
  ...overrides
})

describe('buildApiCheckProvider', () => {
  it('uses the Anthropic protocol and host for an Anthropic endpoint check', () => {
    const result = buildApiCheckProvider({
      provider: makeProvider(),
      hostField: 'anthropicApiHost',
      apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
      anthropicApiHost: ' https://open.bigmodel.cn/api/anthropic ',
      apiKey: 'local-key'
    })

    expect(result).toMatchObject({
      id: 'anthropic',
      type: 'anthropic',
      authType: 'apiKey',
      apiHost: 'https://open.bigmodel.cn/api/anthropic',
      anthropicApiHost: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'local-key'
    })
    expect(getAiSdkProviderId(result)).toBe('anthropic')
    expect(formatApiHost(result.apiHost)).toBe('https://open.bigmodel.cn/api/anthropic/v1')
  })

  it.each(['deepseek', 'openrouter'])('overrides the registered %s provider ID', (providerId) => {
    const result = buildApiCheckProvider({
      provider: makeProvider({ id: providerId }),
      hostField: 'anthropicApiHost',
      apiHost: 'https://openai.example.com',
      anthropicApiHost: 'https://anthropic.example.com',
      apiKey: 'local-key'
    })

    expect(getAiSdkProviderId(result)).toBe('anthropic')
  })

  it('preserves the provider protocol for the default API host check', () => {
    const provider = makeProvider()
    const result = buildApiCheckProvider({
      provider,
      hostField: 'apiHost',
      apiHost: ' https://open.bigmodel.cn/api/paas/v4/ ',
      anthropicApiHost: provider.anthropicApiHost,
      apiKey: 'local-key'
    })

    expect(result).toMatchObject({
      id: 'zhipu',
      type: 'openai',
      apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
      anthropicApiHost: provider.anthropicApiHost,
      apiKey: 'local-key'
    })
  })

  it('rejects an empty active host instead of falling back to another endpoint', () => {
    expect(() =>
      buildApiCheckProvider({
        provider: makeProvider(),
        hostField: 'anthropicApiHost',
        apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
        anthropicApiHost: ' ',
        apiKey: 'local-key'
      })
    ).toThrow('API host is required')
  })
})

describe('getApiCheckModels', () => {
  const embeddingModel = makeModel('Embedding-3')
  const firstChatModel = makeModel('glm-5.1')
  const chatModel = makeModel('glm-5.2')
  const rerankModel = makeModel('bge-reranker-v2-m3')

  it('prefers chat models while keeping embedding models available for an OpenAI endpoint', () => {
    expect(getApiCheckModels([embeddingModel, firstChatModel, chatModel, rerankModel], 'apiHost')).toEqual([
      firstChatModel,
      chatModel,
      embeddingModel
    ])
  })

  it('excludes embedding and rerank models from an Anthropic endpoint check', () => {
    expect(getApiCheckModels([embeddingModel, chatModel, rerankModel], 'anthropicApiHost')).toEqual([chatModel])
  })
})
