import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'

/**
 * AI Stupid Level Smart Router: OpenAI-compatible, with the user's own provider keys. Model ids are
 * routing modes (auto-coding, auto-reasoning, auto-tooling, auto-value, ...) that pick a model per
 * request from continuously re-run benchmarks, or real model ids that pin one model. The list
 * comes from `/v1/models` at runtime.
 *
 * The router is text-only: image, audio, video and file input get `400 unsupported_content`, so
 * every model served here is text-in, including pins whose catalog entry is multimodal.
 */
const TEXT_ONLY_REASON = 'AI Stupid Level routes text only; non-text input is rejected with 400 unsupported_content'
const NON_TEXT_CAPABILITIES: NonNullable<ProviderModelOverride['capabilities']>['remove'] = [
  'image-recognition',
  'audio-recognition',
  'video-recognition',
  'file-input',
  'file-search'
]

/**
 * Routing modes: provider-owned ids, every mode `/v1/models` lists. Every mode routes among
 * tool-calling models.
 */
const ROUTING_MODES: Array<[id: string, name: string]> = [
  ['auto-coding', 'Auto Coding'],
  ['auto-reasoning', 'Auto Reasoning'],
  ['auto-tooling', 'Auto Tool Use'],
  ['auto-best', 'Auto Best'],
  ['auto-task', 'Auto Task'],
  ['auto-value', 'Auto Value'],
  ['auto-value-coding', 'Auto Value Coding'],
  ['auto-value-reasoning', 'Auto Value Reasoning'],
  ['auto-value-tooling', 'Auto Value Tool Use'],
  ['auto-fastest-quality', 'Auto Fastest Quality'],
  ['auto-fastest', 'Auto Fastest'],
  ['auto-cheapest', 'Auto Cheapest'],
  ['auto-consistent', 'Auto Consistent'],
  ['auto-split', 'Auto Split (account traffic split)'],
  ['auto', 'Auto (account strategy)']
]

// apiModelId is always the exact router id: the catalog normalizes `auto-reasoning` to `auto` and
// `auto-value-reasoning` to `auto-value`, and an exact API id is what lookups match first.
const routingModeOverrides = ROUTING_MODES.map(([modelId, name]) => ({
  modelId,
  apiModelId: modelId,
  name,
  ownedBy: 'aistupidlevel',
  capabilities: { force: ['function-call', 'structured-output'] },
  inputModalities: ['text'],
  outputModalities: ['text'],
  // The smallest context and output limit among the models the router can choose.
  limits: { contextWindow: 262_144, maxOutputTokens: 65_536 },
  reason: 'Routing mode owned by AI Stupid Level; routes only among tool-calling models'
})) satisfies Array<Partial<ProviderModelOverride>>

/** Models the router can pin (GET /v1/models, 2026-10-19), as [catalog id, router id]. */
const PINNABLE_MODELS: Array<[modelId: string, apiModelId: string]> = [
  ['claude-opus-5-5', 'claude-opus-5-5'],
  ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
  ['claude-fable-5-1', 'claude-fable-5-1'],
  ['claude-opus-5', 'claude-opus-5'],
  ['claude-sonnet-5', 'claude-sonnet-5'],
  ['claude-opus-4-8', 'claude-opus-4-8'],
  ['claude-opus-4-7', 'claude-opus-4-7'],
  ['claude-opus-4-6', 'claude-opus-4-6'],
  ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['gpt-6-1-sol', 'gpt-6.1-sol'],
  ['gpt-6-sol', 'gpt-6-sol'],
  ['gpt-6-astra', 'gpt-6-astra'],
  ['gpt-6-luna', 'gpt-6-luna'],
  ['gpt-5-6-sol', 'gpt-5.6-sol'],
  ['gpt-5-6-terra', 'gpt-5.6-terra'],
  ['gpt-5-6-luna', 'gpt-5.6-luna'],
  ['gpt-5-5', 'gpt-5.5'],
  ['gemini-3-8-flash', 'gemini-3.8-flash'],
  ['gemini-3-5-flash-lite', 'gemini-3.5-flash-lite'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['kimi-k3', 'kimi-k3'],
  ['kimi-k2-7-code', 'kimi-k2.7-code'],
  ['glm-5-3', 'glm-5.3']
]

const pinnedModelOverrides = PINNABLE_MODELS.map(([modelId, apiModelId]) => ({
  modelId,
  ...(apiModelId !== modelId ? { apiModelId } : {}),
  capabilities: { remove: NON_TEXT_CAPABILITIES },
  inputModalities: ['text'],
  reason: TEXT_ONLY_REASON
})) satisfies Array<Partial<ProviderModelOverride>>

export default defineProvider({
  id: 'aistupidlevel',
  name: 'AI Stupid Level',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://aistupidlevel.info/v1',
      reasoningFormat: { type: 'openai-chat' },
      modelsApiUrls: { default: 'https://aistupidlevel.info/v1/models' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://aistupidlevel.info/router/keys',
      docs: 'https://aistupidlevel.info/router/docs',
      models: 'https://aistupidlevel.info/router/docs#strategies',
      official: 'https://aistupidlevel.info'
    }
  },
  standaloneModelIds: ROUTING_MODES.map(([id]) => id),
  overrides: [...routingModeOverrides, ...pinnedModelOverrides]
})
