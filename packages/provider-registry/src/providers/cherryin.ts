import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider, type ProviderModelOffer } from './types'
import { modeWire } from './wires'

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
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }
] satisfies Array<Partial<ProviderModelOverride>>

const qwenAudioCompatibilityOverrides = [
  {
    apiModelId: 'qwen/qwen3.5-9b',
    modelId: 'qwen3-5-9b',
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

const chatOffers = [
  {
    apiModelId: 'qwen/qwen4-max',
    limits: { contextWindow: 1_000_000 },
    endpointTypes: [...chatEndpoints],
    pricing: {
      input: { currency: 'USD', perMillionTokens: 1.5 },
      output: { currency: 'USD', perMillionTokens: 4.5 },
      cacheRead: { currency: 'USD', perMillionTokens: 0.075 },
      cacheWrite: { currency: 'USD', perMillionTokens: 1.875 }
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
    capabilities: {
      add: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'audio-recognition', 'file-input']
    }
  },
  {
    apiModelId: 'openai/o1-mini',
    name: 'OpenAI o1-mini',
    limits: { contextWindow: 128_000 },
    endpointTypes: [...chatEndpoints],
    capabilities: { add: ['reasoning'] }
  },
  {
    apiModelId: 'x-ai/grok-4.2-agents',
    name: 'Grok 4.2 Agents',
    endpointTypes: ['openai-chat-completions', 'openai-responses'],
    inputModalities: ['text', 'image'],
    capabilities: { add: ['reasoning', 'image-recognition'] }
  },
  {
    apiModelId: 'minimax/minimax-m2.1--lightning',
    modelId: 'minimax-m2-1',
    name: 'MiniMax M2.1 Lightning',
    limits: { contextWindow: 200_000 },
    endpointTypes: [...anthropicFirst]
  },
  ...['5', '5.1', '5.2', '5.3'].map(
    (version): ProviderModelOffer => ({
      apiModelId: `openai/gpt-${version}-chat`,
      name: `GPT-${version} Chat`,
      limits: { contextWindow: 128_000 },
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
      capabilities: { remove: ['structured-output'] }
    },
    ...deepSeekModelOverrides,
    ...qwenAudioCompatibilityOverrides.map((offer): ProviderModelOffer => {
      switch (offer.apiModelId) {
        case 'qwen/qwen3.5-4b(free)':
        case 'qwen/qwen3.5-35b-a3b(free)':
          return { ...offer, pricing: freePricing, endpointTypes: [...chatEndpoints] }
        case 'qwen/qwen3.5-9b(free)':
          return { ...offer, pricing: freePricing, endpointTypes: ['openai-chat-completions'] }
        default:
          return offer
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
        pricing: {
          input: unknownTokenPrice,
          output: unknownTokenPrice,
          perImage: { currency: 'USD', price, unit: 'image' }
        }
      })
    ),
    ...chatOffers
  ]
})
