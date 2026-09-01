import type { ProviderModelOverride } from '../schemas/provider-models'
import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

/**
 * Ark reasoning control (docs/82379/1449737 chat + 1956279 responses): effort SKUs take
 * `reasoning_effort` (chat) / `reasoning.effort` (responses) with values minimal/low/medium/high —
 * `minimal` is the off switch ('none' is glm-5-2-only and rejected elsewhere). `auto` is not an Ark
 * effort value; map it to the server default (medium).
 */
const effortWire = modeWire(
  'reasoningEffort',
  { off: 'minimal', auto: EFFORT, effort: EFFORT },
  { autoEffort: 'medium' }
)

const effortContracts = {
  'openai-chat-completions': { wire: effortWire },
  'openai-responses': { wire: effortWire }
}

/** SKUs accepting reasoning_effort on both APIs (Ark's 调节思考长度 support list). */
const effortModels = [
  'doubao-seed-evolving',
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-pro-260215',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-code-preview-260215',
  'doubao-seed-1-6-251015',
  'doubao-seed-character-260628',
  'doubao-seed-1-8-251228',
  'glm-5-2-260617'
]

/** Ark defaults reasoning effort to high (not medium) on the flagship SKUs. */
const highEffortDefaults = new Set([
  'doubao-seed-evolving',
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628'
])

/** seed-2.x SKUs offered on Ark's `service_tier: 'fast'` low-latency inference. */
const fastTierModels = new Set([
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-pro-260215',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428'
])

/**
 * thinking.type on/off-only SKUs (no reasoning_effort). The provider-level chat wire below speaks
 * thinking.type, but the native openai responses adapter strips unknown providerOptions keys, so the
 * toggle can't reach /responses — pin these to chat-completions where it demonstrably works. (Trade-off:
 * chat replays only the reasoning summary, not encrypted CoT — valid per Ark docs.)
 */
const chatOnlyToggleModels = [
  'doubao-seed-1-6-flash-250828',
  'doubao-seed-1-6-vision-250815',
  'doubao-seed-code-preview-251028',
  'glm-4-7-251222',
  'deepseek-v3-2-251201'
]

/** deepseek v4 takes reasoning_effort (incl. max) on chat only (responses 待支持) — pin + effort wire. */
const chatOnlyEffortModels = ['deepseek-v4-pro-260425', 'deepseek-v4-flash-260425']

/** Pre-250615 models are not served by /responses at all (docs/82379/1585128) — pin to chat. */
const legacyChatModels = [
  // doubao-native 1.5 line (doubao-1-5-pro-32k also covers character-250715, explicitly unsupported)
  'doubao-1-5-thinking-pro-250415',
  'doubao-1-5-thinking-pro-m',
  'doubao-1-5-thinking-vision-pro',
  'doubao-1.5-vision-pro-250328',
  'doubao-1-5-vision-pro-32k-250115',
  'doubao-1.5-vision-lite-250315',
  'doubao-1-5-pro-32k-250115',
  'doubao-1-5-lite-32k-250115',
  'doubao-1-5-pro-256k-250115',
  'doubao-1.5-ui-tars-250328',
  // cross-vendor legacy still listed by Ark (normalized keys cover the dated/size variants)
  'deepseek-v3',
  'deepseek-r1',
  'deepseek-r1-distill-qwen-14b',
  'qwen3-14b'
]

const overrides: Partial<ProviderModelOverride>[] = [
  // The effort SKUs are the 250615+ line Ark serves over /responses, where the built-in web_search tool
  // and encrypted-CoT replay live — list Responses first so it's preferred, keeping chat selectable.
  ...effortModels.map((modelId) => ({
    modelId,
    endpointTypes: ['openai-responses' as const, 'openai-chat-completions' as const],
    ...(fastTierModels.has(modelId) ? { supportsFastMode: true } : {}),
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
  supportedEditions: ['global', 'cn'],
  // Ark 低延迟推理 rides OpenAI's serviceTier option with its own value (docs/82379/1569618).
  fastMode: { transport: 'openai-priority' as const, serviceTier: 'fast' },
  // Chat Completions stays the provider default: endpoint selection falls back to it for any model
  // without `endpointTypes` (user-added custom models, `/models` discoveries that miss an override), and
  // Ark only serves /responses for 250615+ SKUs. Responses is opted into per model below.
  defaultChatEndpoint: 'openai-chat-completions',
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
  // Ark serves built-in web search on the Responses endpoint only (docs/82379/1756990;
  // chat has no web-search parameter). `vendors` keeps Ark-hosted glm/deepseek models
  // out — their eligibility comes from other hosts' declarations.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIds: [
        'doubao-seed-1-8',
        'doubao-seed-2-1-pro',
        'doubao-seed-2-1-turbo',
        'doubao-seed-evolving',
        'doubao-seed-2-0-pro',
        'doubao-seed-2-0-lite',
        'doubao-seed-2-0-mini',
        'doubao-seed-2-0-code-preview',
        'doubao-seed-1-6',
        'doubao-seed-character'
      ],
      vendors: ['doubao']
    }
  ],
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
