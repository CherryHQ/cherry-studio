import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'
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

/** USD per 1M tokens, matching the console's Input / Completion / Input Cache Read columns. */
const rate = (input: number, output: number, cacheRead?: number, cacheWrite?: number) => ({
  input: { currency: 'USD' as const, perMillionTokens: input },
  output: { currency: 'USD' as const, perMillionTokens: output },
  ...(cacheRead !== undefined ? { cacheRead: { currency: 'USD' as const, perMillionTokens: cacheRead } } : {}),
  ...(cacheWrite !== undefined ? { cacheWrite: { currency: 'USD' as const, perMillionTokens: cacheWrite } } : {})
})

/**
 * CherryIN resells at its own rate card (https://open.cherryin.ai/pricing), which diverges from every
 * vendor list price in both directions — an `openai/o1` call costs 2/8 here against OpenAI's 15/60, and
 * the open-weight models models.dev prices at 0 are all billed. So nothing here may inherit pricing from
 * its base model. `[apiModelId, modelId, input, output, cacheRead?, cacheWrite?]`.
 *
 * Two deliberate absences: models the console bills as "Dynamic pricing" (they follow the vendor's
 * official rate, which the base model already carries), and models with no catalog entry to attach to.
 * `agent/*` twins are absent too — they price identically to the vendor-namespaced row they normalize to.
 */
const cherryInRates: Array<[string, string, number, number, number?, number?]> = [
  ['BAAI/bge-reranker-v2-m3', 'bge-reranker-v2-m3', 0, 0],
  ['agent/deepseek-v3.2(free)', 'deepseek-v3-2', 0, 0],
  ['agent/kimi-k2.7-code', 'kimi-k2-7-code', 0.96, 3.98, 0.19],
  ['anthropic/claude-haiku-4.5', 'claude-haiku-4-5', 1, 5, 0.1],
  ['anthropic/claude-opus-4.5', 'claude-opus-4-5', 5, 25, 0.5],
  ['anthropic/claude-opus-4.6', 'claude-opus-4-6', 5, 25, 0.5],
  ['anthropic/claude-opus-4.7', 'claude-opus-4-7', 5, 25, 0.5],
  ['anthropic/claude-opus-4.8', 'claude-opus-4-8', 5, 25, 0.5],
  ['anthropic/claude-opus-5', 'claude-opus-5', 5, 25, 0.5],
  ['anthropic/claude-sonnet-4', 'claude-sonnet-4', 6, 22.5, 0.6, 7.5],
  ['anthropic/claude-sonnet-4.5', 'claude-sonnet-4-5', 6, 22.5, 0.6, 7.5],
  ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6', 3, 15, 0.3, 3.75],
  ['anthropic/claude-sonnet-5', 'claude-sonnet-5', 2, 10, 0.2, 2.5],
  ['baai/bge-m3', 'bge-m3', 0.02, 0],
  ['baai/bge-m3(free)', 'bge-m3', 0, 0],
  ['bytedance/seed-oss-36b-instruct(free)', 'seed-oss-36b-instruct', 0, 0],
  ['deepseek/deepseek-v3.1-terminus', 'deepseek-v3-1-terminus', 0.27, 1, 0.027],
  ['deepseek/deepseek-v3.2(free)', 'deepseek-v3-2', 0, 0],
  ['google/gemini-2.5-flash', 'gemini-2-5-flash', 0.3, 2.5, 0.037],
  ['google/gemini-2.5-flash-image', 'gemini-2-5-flash-image', 0.3, 30],
  ['google/gemini-2.5-flash-lite', 'gemini-2-5-flash-lite', 0.1, 0.4, 0.01],
  ['google/gemini-3.5-flash', 'gemini-3-5-flash', 1.5, 9, 0.15],
  ['google/gemini-3.6-flash', 'gemini-3-6-flash', 1.5, 7.5],
  ['kwai-kolors/kolors(free)', 'kolors', 0, 0],
  ['minimax/minimax-m2.1', 'minimax-m2-1', 0.3, 1.2, 0.03],
  ['minimax/minimax-m2.5', 'minimax-m2-5', 0.3, 1.2, 0.03],
  ['minimax/minimax-m2.5-highspeed', 'minimax-m2-5-highspeed', 0.6, 2.4, 0.03],
  ['minimax/minimax-m2.7', 'minimax-m2-7', 0.3, 1.2, 0.06],
  ['minimax/minimax-m2.7-highspeed', 'minimax-m2-7-highspeed', 0.6, 2.4, 0.06],
  ['minimax/minimax-m3', 'minimax-m3', 0.62, 2.48, 0.12],
  ['moonshotai/kimi-k2.5', 'kimi-k2-5', 0.6, 3, 0.105],
  ['moonshotai/kimi-k2.6', 'kimi-k2-6', 0.95, 3.95, 0.16],
  ['openai/gpt-4o-mini', 'gpt-4o-mini', 0.15, 0.6, 0.08],
  ['openai/gpt-5', 'gpt-5', 1.25, 10, 0.125],
  ['openai/gpt-5-chat', 'gpt-5-chat', 1.75, 14],
  ['openai/gpt-5-codex', 'gpt-5-codex', 1.75, 14, 0.175],
  ['openai/gpt-5-mini', 'gpt-5-mini', 0.25, 2, 0.025],
  ['openai/gpt-5-pro', 'gpt-5-pro', 15, 120, 1.5],
  ['openai/gpt-5.1', 'gpt-5-1', 1.25, 10, 0.125],
  ['openai/gpt-5.1-codex', 'gpt-5-1-codex', 1.25, 10],
  ['openai/gpt-5.2', 'gpt-5-2', 1.75, 14, 0.175],
  ['openai/gpt-5.2-chat', 'gpt-5-2-chat', 1.75, 14],
  ['openai/gpt-5.2-codex', 'gpt-5-2-codex', 1.75, 14],
  ['openai/gpt-5.3-codex', 'gpt-5-3-codex', 1.75, 14, 0.175],
  ['openai/gpt-5.4', 'gpt-5-4', 2.5, 15, 0.25],
  ['openai/gpt-5.4-pro', 'gpt-5-4-pro', 60, 270],
  ['openai/gpt-5.5', 'gpt-5-5', 5, 30, 0.5],
  ['openai/gpt-image-1', 'gpt-image-1', 8, 30, 2],
  ['openai/gpt-image-2', 'gpt-image-2', 8, 30, 2],
  ['openai/o1', 'o1', 2, 8, 0.5],
  ['openai/o3', 'o3', 2, 8, 0.5],
  ['openai/o4-mini', 'o4-mini', 1.1, 4.4, 0.28],
  ['qwen/qwen-image(free)', 'qwen-image', 0, 0],
  ['qwen/qwen-image-edit(free)', 'qwen-image-edit', 0, 0],
  ['qwen/qwen3-235b-a22b-thinking-2507', 'qwen3-235b-a22b', 0.078, 0.312, 0.016],
  ['qwen/qwen3-30b-a3b-instruct-2507', 'qwen3-30b-a3b-instruct', 0.2, 0.8, 0.04],
  ['qwen/qwen3-30b-a3b-instruct-2507(free)', 'qwen3-30b-a3b-instruct', 0, 0],
  ['qwen/qwen3-30b-a3b-thinking-2507', 'qwen3-30b-a3b', 0.09, 0.6, 0.018],
  ['qwen/qwen3-coder-30b-a3b-instruct(free)', 'qwen3-coder-30b-a3b-instruct', 0, 0],
  ['qwen/qwen3-coder-480b-a35b-instruct', 'qwen3-coder-480b-a35b-instruct', 0.22, 0.95, 0.044],
  ['qwen/qwen3-coder-flash', 'qwen3-coder-flash', 0.7, 3.5],
  ['qwen/qwen3-coder-plus', 'qwen3-coder-plus', 2.8, 28],
  ['qwen/qwen3-embedding-0.6b', 'qwen3-embedding-0-6b', 0.01, 0.01],
  ['qwen/qwen3-embedding-0.6b(free)', 'qwen3-embedding-0-6b', 0, 0],
  ['qwen/qwen3-embedding-4b', 'qwen3-embedding-4b', 0.01, 0.01, 0.002],
  ['qwen/qwen3-embedding-8b', 'qwen3-embedding-8b', 0.56, 0.56, 0.112],
  ['qwen/qwen3-max', 'qwen3-max', 1.36, 5.44],
  ['qwen/qwen3-next-80b-a3b-instruct', 'qwen3-next-80b-a3b-instruct', 0.14, 1.4, 0.028],
  ['qwen/qwen3-reranker-0.6b', 'qwen3-reranker-0-6b', 0.01, 0.01],
  ['qwen/qwen3-reranker-0.6b(free)', 'qwen3-reranker-0-6b', 0, 0],
  ['qwen/qwen3-reranker-4b', 'qwen3-reranker-4b', 0.019, 0.019, 0.004],
  ['qwen/qwen3-reranker-8b', 'qwen3-reranker-8b', 0.56, 0.56, 0.112],
  ['qwen/qwen3-vl-235b-a22b-instruct', 'qwen3-vl-235b-a22b-instruct', 0.3, 1.5, 0.06],
  ['qwen/qwen3-vl-235b-a22b-thinking', 'qwen3-vl-235b-a22b', 0.3, 1.5, 0.06],
  ['qwen/qwen3-vl-30b-a3b-instruct(free)', 'qwen3-vl-30b-a3b-instruct', 0, 0],
  ['qwen/qwen3-vl-30b-a3b-thinking(free)', 'qwen3-vl-30b-a3b', 0, 0],
  ['qwen/qwen3-vl-plus', 'qwen3-vl-plus', 0.42, 4.2],
  ['qwen/qwen3.5-flash', 'qwen3-5-flash', 0.171, 1.714],
  ['qwen/qwen3.5-plus', 'qwen3-5-plus', 0.571, 3.429],
  ['qwen/qwen3.6-plus', 'qwen3-6-plus', 0.286, 1.714],
  ['qwen/qwen3.7-max', 'qwen3-7-max', 1.77, 5.3, 0.35],
  ['x-ai/grok-4-1-fast-non-reasoning', 'grok-4-1-fast-non-reasoning', 0.2, 0.5, 0.02],
  ['x-ai/grok-4-1-fast-reasoning', 'grok-4-1-fast', 0.2, 0.5, 0.02],
  ['z-ai/glm-5', 'glm-5', 0.86, 3.156, 0.215],
  ['z-ai/glm-5.2', 'glm-5-2', 1.18, 4.13, 0.3]
]

/**
 * CherryIN prices DeepSeek V4 by the Shanghai clock — peak (09:00-12:00, 14:00-18:00) is double
 * off-peak — and a single rate per model cannot say that. Declared unknown so usage records count as
 * unpriced instead of carrying whichever tier we happened to pick; the live `/api/pricing` fetch
 * reports the same. Give these real rates once pricing can express a time tier.
 */
const timeTieredModels = ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'].map((apiModelId) => ({
  apiModelId,
  modelId: apiModelId.replace('deepseek/deepseek-', 'deepseek-'),
  pricing: {
    input: { currency: 'USD' as const, perMillionTokens: null },
    output: { currency: 'USD' as const, perMillionTokens: null }
  }
})) satisfies Array<Partial<ProviderModelOverride>>

const pricedModelOverrides = cherryInRates.map(([apiModelId, modelId, input, output, cacheRead, cacheWrite]) => ({
  apiModelId,
  modelId,
  // A free tier shares its base model with the paid row; the variant tag keeps the two rows distinct.
  ...(apiModelId.endsWith('(free)') ? { modelVariants: ['free'] } : {}),
  pricing: rate(input, output, cacheRead, cacheWrite)
})) satisfies Array<Partial<ProviderModelOverride>>

const deepSeekModelOverrides = [
  {
    apiModelId: 'deepseek/deepseek-v3.2',
    modelId: 'deepseek-v3-2',
    pricing: rate(0.286, 0.429, 0.029),
    reasoningContracts: {
      'openai-chat-completions': { wire: deepSeekThinkingWire }
    }
  }
] satisfies Array<Partial<ProviderModelOverride>>

const qwenAudioCompatibilityOverrides = [
  {
    apiModelId: 'qwen/qwen3.5-122b-a10b',
    modelId: 'qwen3-5-122b-a10b',
    pricing: rate(0.114, 0.912),
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    apiModelId: 'qwen/qwen3.5-27b',
    modelId: 'qwen3-5-27b',
    pricing: rate(0.086, 0.686),
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    apiModelId: 'qwen/qwen3.5-35b-a3b',
    modelId: 'qwen3-5-35b-a3b',
    pricing: rate(0.057, 0.457),
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    modelId: 'qwen3-5-35b-a3b-free',
    apiModelId: 'qwen/qwen3.5-35b-a3b(free)',
    modelVariants: ['35b', 'free'],
    pricing: rate(0, 0),
    name: 'Qwen3.5 35B A3B (Free)',
    capabilities: { remove: ['audio-recognition', 'video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  },
  {
    apiModelId: 'qwen/qwen3.5-397b-a17b',
    modelId: 'qwen3-5-397b-a17b',
    pricing: rate(0.171, 1.029),
    capabilities: { remove: ['audio-recognition'] },
    inputModalities: ['text', 'image', 'video'],
    reason: 'CherryIN rejects native audio; base Qwen3.5 supports text/image/video input'
  },
  {
    modelId: 'qwen3-5-4b',
    apiModelId: 'qwen/qwen3.5-4b(free)',
    modelVariants: ['4b', 'free'],
    pricing: rate(0, 0),
    name: 'Qwen3.5 4B (Free)',
    capabilities: { remove: ['video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  },
  {
    modelId: 'qwen3-5-9b',
    apiModelId: 'qwen/qwen3.5-9b(free)',
    modelVariants: ['9b', 'free'],
    pricing: rate(0, 0),
    capabilities: { remove: ['audio-recognition', 'video-recognition'] },
    inputModalities: ['text', 'image'],
    reason: 'CherryIN free endpoint accepts text and image_url parts only'
  }
] satisfies Array<Partial<ProviderModelOverride>>

export default defineProvider({
  id: 'cherryin',
  name: 'CherryIN',
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
      apiKey: 'https://open.cherryin.ai/console/token',
      docs: 'https://open.cherryin.ai',
      models: 'https://open.cherryin.ai/pricing',
      official: 'https://open.cherryin.ai'
    }
  },
  overrides: [
    ...deepSeekModelOverrides,
    ...qwenAudioCompatibilityOverrides,
    ...pricedModelOverrides,
    ...timeTieredModels
  ]
})
