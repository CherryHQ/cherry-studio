import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { fetchResolvedProviderModels, resolveCreateModelEndpointTypes, toCreateModelDto } from '../modelSync'

const { dataApiGetMock } = vi.hoisted(() => ({ dataApiGetMock: vi.fn() }))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: dataApiGetMock,
    post: vi.fn()
  }
}))

// listModels goes through ipcApi.request('ai.provider.model.list', …) now (Main IPC).
const { listModelsMock } = vi.hoisted(() => ({ listModelsMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => listModelsMock(input) }
}))

beforeEach(() => {
  vi.clearAllMocks()
  dataApiGetMock.mockResolvedValue([])
  listModelsMock.mockResolvedValue({ models: [] })
})

describe('fetchResolvedProviderModels', () => {
  it('throws when upstream model listing fails instead of returning an empty list', async () => {
    const apiKey = 'sk-should-not-reach-logs'
    const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    listModelsMock.mockRejectedValueOnce(new Error(`upstream failed for ${apiKey}`))

    try {
      await expect(fetchResolvedProviderModels('openai')).rejects.toThrow(`upstream failed for ${apiKey}`)

      expect(listModelsMock).toHaveBeenCalledWith({
        providerId: 'openai',
        throwOnError: true
      })
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to fetch and resolve provider models', {
        providerId: 'openai',
        errorType: 'Error'
      })
      expect(JSON.stringify(loggerErrorSpy.mock.calls)).not.toContain(apiKey)
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })

  it('keeps endpoint types returned by the provider when registry metadata also has endpoint types', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'new-api::agent/deepseek-v3.2',
          providerId: 'new-api',
          apiModelId: 'agent/deepseek-v3.2',
          name: 'agent/deepseek-v3.2',
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'new-api::agent/deepseek-v3.2',
        providerId: 'new-api',
        apiModelId: 'agent/deepseek-v3.2',
        name: 'DeepSeek V3.2',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      }
    ])

    const { models } = await fetchResolvedProviderModels('new-api')

    expect(models[0]).toMatchObject({
      name: 'DeepSeek V3.2',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
  })

  it('uses registry reasoning controls while preserving discovered thinking support', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'ollama::qwen3:32b',
          providerId: 'ollama',
          apiModelId: 'qwen3:32b',
          name: 'qwen3:32b',
          capabilities: [MODEL_CAPABILITY.REASONING]
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'ollama::qwen3:32b',
        providerId: 'ollama',
        apiModelId: 'qwen3:32b',
        presetModelId: 'qwen3-32b',
        name: 'Qwen3 32B',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }],
          selectableEfforts: ['none', 'low', 'medium', 'high']
        }
      }
    ])

    const {
      models: [model]
    } = await fetchResolvedProviderModels('ollama')

    expect(model).toMatchObject({
      name: 'Qwen3 32B',
      presetModelId: 'qwen3-32b',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }],
        selectableEfforts: ['none', 'low', 'medium', 'high']
      }
    })
  })

  it('uses the resolved friendly name when the provider only echoes the raw id', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'dashscope::qwen1.5-1.8b-chat',
          providerId: 'dashscope',
          apiModelId: 'qwen1.5-1.8b-chat',
          name: 'qwen1.5-1.8b-chat'
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dashscope::qwen1.5-1.8b-chat',
        providerId: 'dashscope',
        apiModelId: 'qwen1.5-1.8b-chat',
        name: 'Qwen1.5 1.8b Chat'
      }
    ])

    const { models } = await fetchResolvedProviderModels('dashscope')

    expect(models[0].name).toBe('Qwen1.5 1.8b Chat')
  })

  it.each([
    { kind: 'custom', presetModelId: undefined },
    { kind: 'preset', presetModelId: 'custom-model' }
  ])('keeps a provider display name for a $kind model', async ({ presetModelId }) => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'custom::custom-model',
          providerId: 'custom',
          apiModelId: 'custom-model',
          name: 'Provider Display Name'
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'custom::custom-model',
        providerId: 'custom',
        apiModelId: 'custom-model',
        presetModelId,
        name: 'Custom Model'
      }
    ])

    const { models } = await fetchResolvedProviderModels('custom')

    expect(models[0].name).toBe('Provider Display Name')
  })
})

describe('resolveCreateModelEndpointTypes', () => {
  it('keeps endpoint types from the resolved model metadata', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'new-api',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {
          endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
        }
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_RESPONSES])
  })

  it('uses the provider default endpoint type for new-api compatible providers', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'custom-new-api',
          presetProviderId: 'new-api',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {}
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  })

  it('does not invent an endpoint type when the provider has no default endpoint type', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'custom-new-api',
          presetProviderId: 'new-api'
        },
        {}
      )
    ).toBeUndefined()
  })

  it('does not add endpoint types for regular providers', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'openai',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {}
      )
    ).toBeUndefined()
  })
})

describe('toCreateModelDto', () => {
  it('writes resolved endpoint types into the create payload', () => {
    expect(
      toCreateModelDto(
        'new-api',
        {
          id: 'new-api::gpt-4o',
          providerId: 'new-api',
          apiModelId: 'gpt-4o',
          name: 'GPT-4o'
        } as any,
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      )
    ).toMatchObject({
      providerId: 'new-api',
      modelId: 'gpt-4o',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('does not forward capabilities for a preset-backed model', () => {
    const dto = toCreateModelDto('ppio', {
      id: 'ppio::bge-reranker-v2-m3',
      providerId: 'ppio',
      apiModelId: 'bge-reranker-v2-m3',
      presetModelId: 'bge-reranker-v2-m3',
      name: 'BGE Reranker',
      group: 'rerankers',
      capabilities: [MODEL_CAPABILITY.RERANK, MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toBeUndefined()
    expect(dto).toMatchObject({
      providerId: 'ppio',
      modelId: 'bge-reranker-v2-m3',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('forwards all discovered capabilities for a custom model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme-thinker:latest',
      providerId: 'ollama',
      apiModelId: 'acme-thinker:latest',
      name: 'Acme Thinker',
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
  })

  it('persists a discovered context window so the runtime can send num_ctx', () => {
    // Ollama's window is read from /api/show at listing time, not supplied by the registry;
    // dropping it here leaves the stored row without one and num_ctx is never sent (#18643).
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b',
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      name: 'qwen3:32b',
      capabilities: [],
      contextWindow: 40960,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.contextWindow).toBe(40960)
  })

  it('omits contextWindow when the model has none', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme:latest',
      providerId: 'ollama',
      apiModelId: 'acme:latest',
      name: 'acme:latest',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto).not.toHaveProperty('contextWindow')
  })

  it('keeps registry capabilities inherited for a preset-backed thinking model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b',
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      presetModelId: 'qwen3-32b',
      name: 'Qwen3 32B',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toBeUndefined()
  })
})

it('preserves fetched Poe routing through registry enrichment and the create DTO', async () => {
  const row = {
    id: 'poe::perplexity-adv-deep-research',
    providerId: 'poe',
    apiModelId: 'perplexity-adv-deep-research',
    name: 'perplexity-adv-deep-research'
  }
  listModelsMock.mockResolvedValueOnce({ models: [{ ...row, endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] }] })
  dataApiGetMock.mockResolvedValueOnce([
    { ...row, name: 'Perplexity research', endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] }
  ])
  const {
    models: [model]
  } = await fetchResolvedProviderModels('poe')
  expect(model.endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  expect(toCreateModelDto('poe', model)).toMatchObject({
    providerId: 'poe',
    modelId: row.apiModelId,
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  })
})

describe('live DotHoosh limits and prices through sync', () => {
  const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })
  const livePricing = { input: usd(3), output: usd(15) }
  const registryPricing = { input: usd(1), output: usd(5) }

  it('keeps the limits and pricing the provider listing returned instead of overwriting them with registry values', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'dothoosh::claude-sonnet-5',
          providerId: 'dothoosh',
          apiModelId: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1_000_000,
          maxOutputTokens: 64_000,
          pricing: livePricing
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dothoosh::claude-sonnet-5',
        providerId: 'dothoosh',
        apiModelId: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        presetModelId: 'claude-sonnet-5',
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        pricing: registryPricing
      }
    ])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0]).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 64_000, pricing: livePricing })
  })

  it('fills limits and pricing from the registry only when the listing omitted them', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [{ id: 'dothoosh::m', providerId: 'dothoosh', apiModelId: 'm', name: 'M', contextWindow: 500_000 }]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dothoosh::m',
        providerId: 'dothoosh',
        apiModelId: 'm',
        name: 'M',
        presetModelId: 'm',
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        pricing: registryPricing
      }
    ])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0]).toMatchObject({ contextWindow: 500_000, maxOutputTokens: 8_000, pricing: registryPricing })
  })

  it('does not let a registry input cap exceed the live context window', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [{ id: 'dothoosh::g', providerId: 'dothoosh', apiModelId: 'g', name: 'G', contextWindow: 272_000 }]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dothoosh::g',
        providerId: 'dothoosh',
        apiModelId: 'g',
        name: 'G',
        presetModelId: 'g',
        contextWindow: 1_000_000,
        maxInputTokens: 922_000
      }
    ])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0].contextWindow).toBe(272_000)
    expect(models[0].maxInputTokens === undefined || models[0].maxInputTokens <= 272_000).toBe(true)
  })

  it('saves the published output limit and pricing of a model that is not in the registry', () => {
    const dto = toCreateModelDto('dothoosh', {
      id: 'dothoosh::brand-new',
      providerId: 'dothoosh',
      apiModelId: 'brand-new',
      name: 'Brand New',
      capabilities: [],
      contextWindow: 272_000,
      maxOutputTokens: 32_000,
      pricing: livePricing,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto).toMatchObject({ contextWindow: 272_000, maxOutputTokens: 32_000, pricing: livePricing })
  })

  it('does not freeze registry pricing into a preset-backed row of a provider without a live catalog', () => {
    const dto = toCreateModelDto('openrouter', {
      id: 'openrouter::claude-sonnet-5',
      providerId: 'openrouter',
      apiModelId: 'claude-sonnet-5',
      presetModelId: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      capabilities: [],
      maxOutputTokens: 8_000,
      pricing: registryPricing,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto).not.toHaveProperty('pricing')
    expect(dto).not.toHaveProperty('maxOutputTokens')
  })

  it('saves the live output limit and pricing of a preset-backed DotHoosh row too', () => {
    const dto = toCreateModelDto('dothoosh', {
      id: 'dothoosh::claude-sonnet-5',
      providerId: 'dothoosh',
      apiModelId: 'claude-sonnet-5',
      presetModelId: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      capabilities: [],
      maxOutputTokens: 64_000,
      pricing: livePricing,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto).toMatchObject({ maxOutputTokens: 64_000, pricing: livePricing })
  })

  it.each(['openrouter', 'ollama', 'ppio'])(
    'still lets the registry override what the %s listing returned',
    async (providerId) => {
      listModelsMock.mockResolvedValueOnce({
        models: [
          {
            id: `${providerId}::m`,
            providerId,
            apiModelId: 'm',
            name: 'M',
            contextWindow: 1_000_000,
            maxOutputTokens: 64_000,
            pricing: livePricing
          }
        ]
      })
      dataApiGetMock.mockResolvedValueOnce([
        {
          id: `${providerId}::m`,
          providerId,
          apiModelId: 'm',
          name: 'M',
          presetModelId: 'm',
          contextWindow: 200_000,
          maxOutputTokens: 8_000,
          pricing: registryPricing
        }
      ])

      const { models } = await fetchResolvedProviderModels(providerId)

      expect(models[0]).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 8_000, pricing: registryPricing })
    }
  )
})

describe('live-catalog identity: a duplicated DotHoosh provider keeps live limits and prices', () => {
  const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })
  const livePricing = { input: usd(3), output: usd(15) }
  const registryPricing = { input: usd(1), output: usd(5) }
  // A duplicated DotHoosh provider: UUID instance id, presetProviderId 'dothoosh'.
  const DUPLICATED_ID = '6f1c2a9e-3b7d-4c58-9a10-2d4e8b5f7c31'

  const listedSonnet = (overrides: Record<string, unknown> = {}) => ({
    id: `${DUPLICATED_ID}::claude-sonnet-5`,
    providerId: DUPLICATED_ID,
    apiModelId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    pricing: livePricing,
    ...overrides
  })

  const registrySonnet = (overrides: Record<string, unknown> = {}) => ({
    id: `${DUPLICATED_ID}::claude-sonnet-5`,
    providerId: DUPLICATED_ID,
    apiModelId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    presetModelId: 'claude-sonnet-5',
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    pricing: registryPricing,
    ...overrides
  })

  const presetBackedModel = {
    id: `${DUPLICATED_ID}::claude-sonnet-5` as const,
    providerId: DUPLICATED_ID,
    apiModelId: 'claude-sonnet-5',
    presetModelId: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    capabilities: [],
    maxOutputTokens: 64_000,
    pricing: livePricing,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }

  it('lets the live listing win over the registry when the preset is dothoosh', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedSonnet()] })
    dataApiGetMock.mockResolvedValueOnce([registrySonnet()])

    const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, 'dothoosh')

    expect(models[0]).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 64_000, pricing: livePricing })
    expect(dataApiGetMock).toHaveBeenCalledWith(`/providers/${DUPLICATED_ID}/models:resolve`, expect.anything())
  })

  it('fills only the gaps in the live listing from the registry when the preset is dothoosh', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [listedSonnet({ contextWindow: 500_000, maxOutputTokens: undefined, pricing: undefined })]
    })
    dataApiGetMock.mockResolvedValueOnce([registrySonnet()])

    const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, 'dothoosh')

    expect(models[0]).toMatchObject({ contextWindow: 500_000, maxOutputTokens: 8_000, pricing: registryPricing })
  })

  it('does not let a registry input cap exceed the live context window when the preset is dothoosh', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [listedSonnet({ contextWindow: 272_000, maxOutputTokens: undefined, pricing: undefined })]
    })
    dataApiGetMock.mockResolvedValueOnce([registrySonnet({ contextWindow: 1_000_000, maxInputTokens: 922_000 })])

    const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, 'dothoosh')

    expect(models[0].contextWindow).toBe(272_000)
    expect(models[0].maxInputTokens === undefined || models[0].maxInputTokens <= 272_000).toBe(true)
  })

  it('keeps registry-over-listing precedence when the preset is another provider', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedSonnet()] })
    dataApiGetMock.mockResolvedValueOnce([registrySonnet()])

    const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, 'openrouter')

    expect(models[0]).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 8_000, pricing: registryPricing })
  })

  it.each([undefined, null, ''])(
    'keeps registry-over-listing precedence when there is no preset (%s)',
    async (presetProviderId) => {
      listModelsMock.mockResolvedValueOnce({ models: [listedSonnet()] })
      dataApiGetMock.mockResolvedValueOnce([registrySonnet()])

      const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, presetProviderId)

      expect(models[0]).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 8_000, pricing: registryPricing })
    }
  )

  it('treats a provider as live-catalog when its id is dothoosh even if the preset is another provider', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [listedSonnet({ id: 'dothoosh::claude-sonnet-5', providerId: 'dothoosh' })]
    })
    dataApiGetMock.mockResolvedValueOnce([registrySonnet({ id: 'dothoosh::claude-sonnet-5', providerId: 'dothoosh' })])

    const { models } = await fetchResolvedProviderModels('dothoosh', 'openrouter')

    expect(models[0]).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 64_000, pricing: livePricing })
  })

  it('saves the live output limit and pricing of a preset-backed row of a duplicated dothoosh provider', () => {
    const dto = toCreateModelDto(DUPLICATED_ID, presetBackedModel, undefined, 'dothoosh')

    expect(dto).toMatchObject({ maxOutputTokens: 64_000, pricing: livePricing })
  })

  it('saves all listed limits of a row not in the registry for a duplicated dothoosh provider', () => {
    const dto = toCreateModelDto(
      DUPLICATED_ID,
      {
        id: `${DUPLICATED_ID}::brand-new`,
        providerId: DUPLICATED_ID,
        apiModelId: 'brand-new',
        name: 'Brand New',
        capabilities: [],
        contextWindow: 272_000,
        maxOutputTokens: 32_000,
        pricing: livePricing,
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      undefined,
      'dothoosh'
    )

    expect(dto).toMatchObject({ contextWindow: 272_000, maxOutputTokens: 32_000, pricing: livePricing })
  })

  it('does not freeze registry pricing into a preset-backed row when the preset is another provider', () => {
    const dto = toCreateModelDto(DUPLICATED_ID, presetBackedModel, undefined, 'openrouter')

    expect(dto).not.toHaveProperty('pricing')
    expect(dto).not.toHaveProperty('maxOutputTokens')
  })

  it.each([undefined, null])(
    'does not freeze registry pricing into a preset-backed row when there is no preset (%s)',
    (presetProviderId) => {
      const dto = toCreateModelDto(DUPLICATED_ID, presetBackedModel, undefined, presetProviderId)

      expect(dto).not.toHaveProperty('pricing')
      expect(dto).not.toHaveProperty('maxOutputTokens')
    }
  )
})

describe('T3: a registry input cap is bounded to the live context window', () => {
  const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })
  const livePricing = { input: usd(3), output: usd(15) }
  const registryPricing = { input: usd(1), output: usd(5) }
  const DUPLICATED_ID = '6f1c2a9e-3b7d-4c58-9a10-2d4e8b5f7c31'

  // Registry entry for the fixture id `g`: the registry input cap sits above the live window below.
  const registryG = (overrides: Record<string, unknown> = {}) => ({
    id: 'dothoosh::g',
    providerId: 'dothoosh',
    apiModelId: 'g',
    name: 'G',
    presetModelId: 'g',
    contextWindow: 1_050_000,
    maxInputTokens: 922_000,
    maxOutputTokens: 128_000,
    pricing: registryPricing,
    ...overrides
  })

  const listedG = (overrides: Record<string, unknown> = {}) => ({
    id: 'dothoosh::g',
    providerId: 'dothoosh',
    apiModelId: 'g',
    name: 'G',
    contextWindow: 272_000,
    ...overrides
  })

  it('bounds an inherited registry input cap to the live context window in the enriched model', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedG()] })
    dataApiGetMock.mockResolvedValueOnce([registryG()])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0].contextWindow).toBe(272_000)
    expect(models[0].maxInputTokens).toBe(272_000)
  })

  it('persists the bounded input cap in the create DTO of the canonical dothoosh provider', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedG()] })
    dataApiGetMock.mockResolvedValueOnce([registryG()])
    const { models } = await fetchResolvedProviderModels('dothoosh')

    const dto = toCreateModelDto('dothoosh', models[0])

    expect(dto).toMatchObject({ contextWindow: 272_000, maxInputTokens: 272_000 })
  })

  it('persists the bounded input cap in the create DTO of a duplicated dothoosh provider', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [listedG({ id: `${DUPLICATED_ID}::g`, providerId: DUPLICATED_ID })]
    })
    dataApiGetMock.mockResolvedValueOnce([registryG({ id: `${DUPLICATED_ID}::g`, providerId: DUPLICATED_ID })])
    const { models } = await fetchResolvedProviderModels(DUPLICATED_ID, 'dothoosh')

    const dto = toCreateModelDto(DUPLICATED_ID, models[0], undefined, 'dothoosh')

    expect(dto.maxInputTokens).toBe(272_000)
  })

  it('keeps the registry input cap when the live context window is above it', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedG({ contextWindow: 2_000_000 })] })
    dataApiGetMock.mockResolvedValueOnce([registryG()])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0].maxInputTokens).toBe(922_000)
  })

  it('forwards every live limit and price to the create DTO, with the input cap bounded to the live window', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [listedG({ contextWindow: 272_000, maxOutputTokens: 64_000, pricing: livePricing })]
    })
    dataApiGetMock.mockResolvedValueOnce([registryG()])
    const { models } = await fetchResolvedProviderModels('dothoosh')

    const dto = toCreateModelDto('dothoosh', models[0])

    expect(dto).toMatchObject({
      contextWindow: 272_000,
      maxOutputTokens: 64_000,
      pricing: livePricing,
      maxInputTokens: 272_000
    })
  })

  it('does not clamp the input cap when the live listing has no context window', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [listedG({ contextWindow: undefined })] })
    dataApiGetMock.mockResolvedValueOnce([registryG()])

    const { models } = await fetchResolvedProviderModels('dothoosh')

    expect(models[0].maxInputTokens).toBe(922_000)
  })

  it('does not forward an input cap for a preset-backed model of a provider that keeps registry limits', () => {
    const dto = toCreateModelDto('openrouter', {
      id: 'openrouter::x',
      providerId: 'openrouter',
      apiModelId: 'x',
      presetModelId: 'x',
      name: 'X',
      contextWindow: 272_000,
      maxInputTokens: 922_000,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as any)

    expect(dto).not.toHaveProperty('maxInputTokens')
  })
})
