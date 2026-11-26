import type { ProviderModelOverride } from '../schemas/provider-models'
import { cherryInPublishedPriceOffers, unknownCherryInTokenPricing } from './cherryinPricing'
import { defineProvider, type ProviderModelOffer } from './types'
import { EFFORT, modeWire } from './wires'

const claudeWebToolModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]
const geminiWebToolModels = [
  'gemini-2',
  'gemini-3',
  'gemini-4-argon',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest'
]
const openAIWebSearchModels = ['gpt-4o', 'gpt-4-1', 'gpt-5', 'o3', 'o4']

const deepSeekThinkingWire = modeWire('extra_body.thinking.type', {
  off: 'disabled',
  auto: 'enabled',
  effort: 'enabled'
})

const deepSeekModelOverrides = [
  {
    apiModelId: 'deepseek/deepseek-v3.2',
    modelId: 'deepseek-v3-2',
    pricing: unknownCherryInTokenPricing,
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }
] satisfies Array<Partial<ProviderModelOverride>>

const qwenAudioCompatibilityOverrides = [
  {
    apiModelId: 'qwen/qwen3.5-9b',
    modelId: 'qwen3-5-9b',
    pricing: unknownCherryInTokenPricing,
    capabilities: { remove: ['audio-recognition', 'video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN rejects native audio and video for the Qwen3.5 9B endpoint'
  },
  {
    apiModelId: 'qwen/qwen3.5-122b-a10b',
    modelId: 'qwen3-5-122b-a10b',
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    apiModelId: 'qwen/qwen3.5-27b',
    modelId: 'qwen3-5-27b',
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    apiModelId: 'qwen/qwen3.5-35b-a3b',
    modelId: 'qwen3-5-35b-a3b',
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    modelId: 'qwen3-5-35b-a3b-free',
    apiModelId: 'qwen/qwen3.5-35b-a3b(free)',
    modelVariants: ['35b', 'free'],
    name: 'Qwen3.5 35B A3B (Free)',
    capabilities: { remove: ['audio-recognition', 'video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  },
  {
    apiModelId: 'qwen/qwen3.5-397b-a17b',
    modelId: 'qwen3-5-397b-a17b',
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    modelId: 'qwen3-5-4b',
    apiModelId: 'qwen/qwen3.5-4b(free)',
    modelVariants: ['4b', 'free'],
    name: 'Qwen3.5 4B (Free)',
    capabilities: { remove: ['video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  },
  {
    modelId: 'qwen3-5-9b-free',
    apiModelId: 'qwen/qwen3.5-9b(free)',
    modelVariants: ['9b', 'free'],
    name: 'Qwen3.5 9B (Free)',
    capabilities: { remove: ['audio-recognition', 'video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  }
] satisfies Array<Partial<ProviderModelOverride>>

const zeroPrice = { currency: 'USD', perMillionTokens: 0 } as const
const freePricing = {
  input: zeroPrice,
  output: zeroPrice,
  cacheRead: zeroPrice,
  cacheWrite: zeroPrice,
  inputTokenTiers: []
}
const freeImagePricing = { ...freePricing, perImage: { currency: 'USD', price: 0, unit: 'image' } } as const
const unknownTokenPrice = { currency: 'USD', perMillionTokens: null } as const
const perImagePricing = (price: number) => ({
  input: unknownTokenPrice,
  output: unknownTokenPrice,
  perImage: { currency: 'USD', price, unit: 'image' } as const
})
const tokenPrice = (perMillionTokens: number | null) => ({ currency: 'USD' as const, perMillionTokens })
const tokenRates = (
  input: number,
  output: number,
  cacheRead: number | null = null,
  cacheWrite: number | null = null
) => ({
  input: tokenPrice(input),
  output: tokenPrice(output),
  cacheRead: tokenPrice(cacheRead),
  cacheWrite: tokenPrice(cacheWrite)
})
const flatPricing = (input: number, output: number, cacheRead?: number, cacheWrite?: number) => ({
  ...tokenRates(input, output, cacheRead, cacheWrite),
  inputTokenTiers: []
})
// https://open.cherryin.ai/api/pricing reports USD token rates as model_ratio × 2.
const qwen35Pricing: Record<string, ReturnType<typeof flatPricing>> = {
  'qwen/qwen3.5-27b': flatPricing(0.085714, 0.685712),
  'qwen/qwen3.5-35b-a3b': flatPricing(0.057142, 0.457136),
  'qwen/qwen3.5-122b-a10b': flatPricing(0.114, 0.912),
  'qwen/qwen3.5-397b-a17b': flatPricing(0.171428, 1.028568)
}
const chatEndpoints = ['openai-chat-completions', 'anthropic-messages'] as const
const anthropicFirst = ['anthropic-messages', 'openai-chat-completions'] as const
const responsesEndpoints = ['openai-responses', 'anthropic-messages'] as const

const freeOffers = [
  {
    apiModelId: 'tencent/hunyuan-mt-7b(free)',
    name: 'Hunyuan MT 7B (Free)',
    endpointTypes: [...chatEndpoints],
    inputModalities: ['text'],
    outputModalities: ['text']
  },
  {
    apiModelId: 'deepseek/deepseek-ocr(free)',
    name: 'DeepSeek OCR (Free)',
    endpointTypes: ['openai-chat-completions']
  },
  {
    apiModelId: 'agent/qwen3-coder-30b-a3b-instruct(free)',
    modelId: 'qwen3-coder-30b-a3b-instruct-free',
    name: 'Qwen3 Coder 30B A3B Instruct (Free, Agent)',
    limits: { contextWindow: 262_144 },
    endpointTypes: [...anthropicFirst]
  },
  { apiModelId: 'baai/bge-m3(free)', endpointTypes: ['openai-embeddings'] },
  {
    apiModelId: 'deepseek/deepseek-v3.2(free)',
    modelId: 'deepseek-v3-2',
    limits: { contextWindow: 128_000 },
    endpointTypes: [...anthropicFirst],
    reasoningContracts: { 'openai-chat-completions': { wire: deepSeekThinkingWire } }
  },
  {
    apiModelId: 'agent/deepseek-v3.2(free)',
    modelId: 'deepseek-v3-2',
    limits: { contextWindow: 128_000 },
    endpointTypes: [...anthropicFirst],
    reasoningContracts: { 'openai-chat-completions': { wire: deepSeekThinkingWire } }
  },
  { apiModelId: 'qwen/qwen3-reranker-0.6b(free)', endpointTypes: ['jina-rerank'] },
  { apiModelId: 'BAAI/bge-reranker-v2-m3(free)', endpointTypes: ['jina-rerank'] },
  {
    apiModelId: 'bytedance/seed-oss-36b-instruct(free)',
    endpointTypes: [...chatEndpoints],
    limits: { contextWindow: 512_000 }
  },
  {
    apiModelId: 'qwen/qwen3-30b-a3b-instruct-2507(free)',
    modelId: 'qwen3-30b-a3b-instruct',
    endpointTypes: [...chatEndpoints]
  },
  { apiModelId: 'qwen/qwen3-embedding-0.6b(free)', endpointTypes: ['openai-embeddings'] },
  {
    apiModelId: 'qwen/qwen3-vl-30b-a3b-instruct(free)',
    endpointTypes: [...chatEndpoints],
    modelId: 'qwen3-vl-30b-a3b-instruct'
  },
  {
    apiModelId: 'qwen/qwen3-coder-30b-a3b-instruct(free)',
    modelId: 'qwen3-coder-30b-a3b-instruct',
    endpointTypes: [...chatEndpoints]
  }
] satisfies ProviderModelOffer[]

const imageOffers = [
  { apiModelId: 'qwen/qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro', price: 0.068493150685 },
  { apiModelId: 'qwen/qwen-image-plus', name: 'Qwen Image Plus', price: 0.027397260274 },
  { apiModelId: 'qwen/qwen-image-2.0', name: 'Qwen Image 2.0', price: 0.027397260274 },
  { apiModelId: 'bytedance/seedream-4.0', name: 'Seedream 4.0', price: 0.027397260274 },
  { apiModelId: 'qwen/z-image-turbo', name: 'Z-Image Turbo', price: 0.013698630137 }
]
const pricedImageOffers = [
  { apiModelId: 'wan/wan2.7-image-pro', price: 0.068493150685 },
  { apiModelId: 'wan/wan2.7-image', price: 0.027397260274 },
  { apiModelId: 'qwen/qwen-image', price: 0.034246575342 },
  { apiModelId: 'qwen/qwen-image-edit-2509', modelId: 'qwen-image-edit', price: 0.041095890411 }
]

const chatOffers = [
  {
    apiModelId: 'qwen/qwen4-max',
    limits: { contextWindow: 1_000_000 },
    endpointTypes: [...chatEndpoints],
    pricing: flatPricing(1.5, 4.5, 0.075, 1.875),
    reasoningContracts: {
      'openai-chat-completions': {
        wire: {
          ...modeWire('enable_thinking', { off: false, auto: true }),
          effort: {
            operations: [
              { target: 'enable_thinking', value: { source: 'literal', value: true } },
              { target: 'reasoningEffort', value: EFFORT }
            ]
          }
        }
      },
      'anthropic-messages': {
        wire: {
          ...modeWire('thinking.type', { off: 'disabled' }),
          ...modeWire('effort', { auto: 'high', effort: EFFORT })
        }
      }
    }
  },
  {
    apiModelId: 'google/gemini-3-pro-preview',
    modelId: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    limits: { contextWindow: 1_000_000 },
    endpointTypes: ['google-generate-content', ...chatEndpoints],
    inputModalities: ['text', 'image', 'video', 'audio'],
    outputModalities: ['text'],
    pricing: {
      ...tokenRates(2, 12, 0.2),
      inputTokenTiers: [{ minInputTokens: 200_001, ...tokenRates(4, 18, 0.4) }]
    },
    capabilities: {
      add: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'audio-recognition', 'file-input']
    }
  },
  {
    apiModelId: 'openai/o1-mini',
    name: 'OpenAI o1-mini',
    limits: { contextWindow: 128_000 },
    pricing: flatPricing(1.1, 4.4, 0.28),
    endpointTypes: [...chatEndpoints],
    capabilities: { add: ['reasoning'] }
  },
  {
    apiModelId: 'x-ai/grok-4.2-agents',
    name: 'Grok 4.2 Agents',
    endpointTypes: ['openai-chat-completions', 'openai-responses'],
    inputModalities: ['text', 'image'],
    pricing: {
      ...tokenRates(1.25, 2.5, 0.2),
      inputTokenTiers: [{ minInputTokens: 200_000, ...tokenRates(2.5, 5, 0.4) }]
    },
    capabilities: { add: ['reasoning', 'image-recognition'] }
  },
  {
    apiModelId: 'minimax/minimax-m2.1--lightning',
    modelId: 'minimax-m2-1',
    name: 'MiniMax M2.1 Lightning',
    pricing: flatPricing(0.3, 1.2, 0.03),
    limits: { contextWindow: 200_000 },
    endpointTypes: [...anthropicFirst]
  },
  ...['5', '5.1', '5.2', '5.3'].map(
    (version): ProviderModelOffer => ({
      apiModelId: `openai/gpt-${version}-chat`,
      name: `GPT-${version} Chat`,
      limits: { contextWindow: 128_000 },
      pricing: version === '5.1' ? flatPricing(1.25, 10, 0.125) : flatPricing(1.75, 14),
      endpointTypes: [...responsesEndpoints],
      ...(version === '5.3'
        ? { capabilities: { add: ['function-call'] } }
        : {
            inputModalities: ['text', 'image'],
            capabilities: { add: ['function-call', 'image-recognition', 'file-input'] }
          })
    })
  )
] satisfies ProviderModelOffer[]

export default defineProvider({
  id: 'cherryin',
  name: 'CherryIN',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'google-generate-content': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'openai-responses': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net'
    },
    'openai-chat-completions': {
      adapterFamily: 'cherryin',
      baseUrl: 'https://open.cherryin.net',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  // Gateway-mapped delivery: `resolveToolCapability` falls back to the vendor
  // segment of the model provider id (`cherryin.gemini` → google's factory), so
  // only vendors owning a native tool factory are servable — a deepseek/glm/kimi
  // model would resolve no factory and inject nothing.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels, ...openAIWebSearchModels],
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
      vendors: ['anthropic', 'gemini', 'openai']
    },
    {
      id: 'url-context',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebToolModels, ...geminiWebToolModels],
      vendors: ['anthropic', 'gemini']
    }
  ],
  metadata: {
    website: {
      billing: 'https://open.cherryin.ai/console/topup',
      apiKey: 'https://open.cherryin.ai/console/token',
      docs: 'https://open.cherryin.ai',
      models: 'https://open.cherryin.ai/pricing',
      official: 'https://open.cherryin.ai'
    }
  },
  overrides: [
    {
      modelId: 'claude-fable-5-2',
      apiModelId: 'anthropic/claude-fable-5.2',
      endpointTypes: ['anthropic-messages', 'openai-chat-completions'],
      pricing: flatPricing(8, 40, 0.2, 10),
      capabilities: { remove: ['structured-output'] }
    },
    ...deepSeekModelOverrides,
    ...qwenAudioCompatibilityOverrides.map((offer): ProviderModelOffer => {
      switch (offer.apiModelId) {
        case 'qwen/qwen3.5-4b(free)':
        case 'qwen/qwen3.5-35b-a3b(free)':
          return {
            ...offer,
            pricing: freePricing,
            endpointTypes: [...chatEndpoints],
            limits: { contextWindow: 262_144 }
          }
        case 'qwen/qwen3.5-9b(free)':
          return {
            ...offer,
            pricing: freePricing,
            endpointTypes: ['openai-chat-completions'],
            limits: { contextWindow: 262_144 }
          }
        default: {
          const pricing = qwen35Pricing[offer.apiModelId]
          return pricing ? { ...offer, pricing, endpointTypes: ['openai-chat-completions'] } : offer
        }
      }
    }),
    ...freeOffers.map((offer) => ({ ...offer, pricing: freePricing })),
    ...[
      {
        apiModelId: 'qwen/qwen-image-edit-2509(free)',
        modelId: 'qwen-image-edit-2509-free',
        name: 'Qwen Image Edit 2509 (Free)'
      },
      { apiModelId: 'kwai-kolors/kolors(free)' },
      { apiModelId: 'qwen/qwen-image(free)' },
      { apiModelId: 'qwen/qwen-image-edit(free)' }
    ].map(
      (offer): ProviderModelOffer => ({
        ...offer,
        pricing: freeImagePricing,
        endpointTypes: ['openai-image-generation']
      })
    ),
    ...imageOffers.map(
      ({ apiModelId, name, price }): ProviderModelOffer => ({
        apiModelId,
        name,
        endpointTypes: ['openai-image-generation'],
        inputModalities: ['text'],
        outputModalities: ['image'],
        capabilities: { add: ['image-generation'] },
        imageGeneration: { modes: { generate: { supports: {} } } },
        pricing: perImagePricing(price)
      })
    ),
    ...pricedImageOffers.map(
      ({ apiModelId, modelId, price }): ProviderModelOffer => ({
        apiModelId,
        modelId,
        endpointTypes: [apiModelId === 'qwen/qwen-image-edit-2509' ? 'openai-image-edit' : 'openai-image-generation'],
        pricing: perImagePricing(price)
      })
    ),
    ...chatOffers,
    ...cherryInPublishedPriceOffers
  ]
})
