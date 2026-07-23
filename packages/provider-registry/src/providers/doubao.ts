import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'

/**
 * Ark reasoning control (docs/82379/1449737 chat + 1956279 responses): effort SKUs take
 * `reasoning_effort` (chat) / `reasoning.effort` (responses) with values minimal/low/medium/high —
 * `minimal` is the off switch ('none' is glm-5-2-only and rejected elsewhere). `auto` is not an Ark
 * effort value; map it to the server default (medium).
 */
const effortWire = {
  off: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'literal' as const, value: 'minimal' } }]
  },
  auto: {
    operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }],
    effortMap: { auto: 'medium' as const }
  },
  effort: { operations: [{ target: 'reasoningEffort' as const, value: { source: 'effort' as const } }] }
}

const effortContracts = {
  'openai-chat-completions': { wire: effortWire },
  'openai-responses': { wire: effortWire }
}

/** SKUs accepting reasoning_effort on both APIs (Ark's 调节思考长度 support list). */
const effortModels = [
  'doubao-seed-evolving',
  'doubao-seed-2-1-pro',
  'doubao-seed-2-1-turbo',
  'doubao-seed-2-0-pro',
  'doubao-seed-2-0-lite',
  'doubao-seed-2-0-mini',
  'doubao-seed-2-0-code',
  'doubao-seed-1-6',
  'doubao-seed-character',
  'seed-1-8',
  'glm-5-2'
]

/** Ark defaults reasoning effort to high (not medium) on the flagship SKUs. */
const highEffortDefaults = new Set(['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-1-turbo'])

/**
 * Responses-capable current-gen SKUs serving Ark's built-in web_search tool ({type:'web_search'} on
 * /responses). Flash is excluded — Ark explicitly discourages built-in tools on it (docs/82379/1585128).
 */
const webSearchModels = new Set(effortModels.filter((id) => id !== 'glm-5-2'))

/**
 * thinking.type on/off-only SKUs (no reasoning_effort). The provider-level chat wire below speaks
 * thinking.type, but the native openai responses adapter strips unknown providerOptions keys, so the
 * toggle can't reach /responses — pin these to chat-completions where it demonstrably works. (Trade-off:
 * chat replays only the reasoning summary, not encrypted CoT — valid per Ark docs.)
 */
const chatOnlyToggleModels = [
  'doubao-seed-1-6-flash',
  'doubao-seed-1-6-vision',
  'doubao-seed-code-preview',
  'glm-4-7',
  'deepseek-v3-2'
]

/** deepseek v4 takes reasoning_effort (incl. max) on chat only (responses 待支持) — pin + effort wire. */
const chatOnlyEffortModels = ['deepseek-v4-pro', 'deepseek-v4-flash']

/** Pre-250615 models are not served by /responses at all (docs/82379/1585128) — pin to chat. */
const legacyChatModels = [
  // doubao-native 1.5 line (doubao-1-5-pro-32k also covers character-250715, explicitly unsupported)
  'doubao-1-5-thinking-pro',
  'doubao-1-5-thinking-pro-m',
  'doubao-1-5-thinking-vision-pro',
  'doubao-1-5-vision-pro',
  'doubao-1-5-vision-pro-32k',
  'doubao-1-5-vision-lite',
  'doubao-1-5-pro-32k',
  'doubao-1-5-lite-32k',
  'doubao-1-5-pro-256k',
  'doubao-1-5-ui-tars',
  // cross-vendor legacy still listed by Ark (normalized keys cover the dated/size variants)
  'deepseek-v3',
  'deepseek-r1',
  'deepseek-r1-distill-qwen-14b',
  'qwen3-14b'
]

const overrides: Partial<ProviderModelOverride>[] = [
  ...effortModels.map((modelId) => ({
    modelId,
    ...(webSearchModels.has(modelId) ? { capabilities: { add: ['web-search' as const] } } : {}),
    reasoningContracts: highEffortDefaults.has(modelId)
      ? {
          'openai-chat-completions': {
            ...effortContracts['openai-chat-completions'],
            support: { defaultEffort: 'high' as const }
          },
          'openai-responses': { ...effortContracts['openai-responses'], support: { defaultEffort: 'high' as const } }
        }
      : effortContracts
  })),
  ...chatOnlyEffortModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const],
    reasoningContracts: { 'openai-chat-completions': { wire: effortWire } }
  })),
  ...chatOnlyToggleModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const]
  })),
  ...legacyChatModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-chat-completions' as const]
  }))
]

export default defineProvider({
  id: 'doubao',
  name: 'doubao',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
          auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'auto' } }] },
          effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }] }
        }
      }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.volcengine.com/experience/ark',
      docs: 'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1099455?lang=zh',
      models: 'https://console.volcengine.com/ark/region:cn-beijing/model?view=CARD_VIEW',
      official: 'https://console.volcengine.com/ark/'
    }
  },
  overrides
})
