import type { ProviderModelOverride } from '../schemas/provider-models'
import {
  effortChatWire,
  highMaxSupport,
  kimiK3Support,
  qwen38ChatWire,
  qwen38PreviewChatWire,
  qwen38PreviewSupport,
  qwen38Support,
  qwenChatWire
} from './qwenFamily'
import { defineProvider } from './types'

/**
 * Hybrid-thinking Qwen lines whose Chat Completions contract is the family-wide toggle + budget wire.
 * Wire ids keep the vendor's dots; generation splits them into canonical `modelId` + `apiModelId`.
 */
const qwenChatModels = [
  'qwen-plus',
  'qwen-flash',
  'qwen-turbo',
  'qwen3-max',
  'qwen3.5-plus',
  'qwen3.5-flash',
  'qwen3.6-plus',
  'qwen3.6-flash',
  'qwen3.6-max-preview',
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3.7-flash',
  'qwen3-omni-flash',
  'qwen3-vl-plus'
]

/** GLM hosted lines take a `high`/`max` effort on Chat Completions. */
const highMaxModels = ['glm-5', 'glm-5.1']

/**
 * Hand-curated listing rows (no reasoning contract): hosted third-party lines, open-weight and
 * multimodal/coder SKUs, plus legacy aliases kept from the international catalog's history.
 */
const listedModels = [
  'deepseek-v3',
  'deepseek-v3.1',
  'deepseek-v3.2',
  'deepseek-r1',
  'glm-4.7',
  'glm-5.3',
  'kimi-k2.7-code',
  'qwen3.8-2.4t-a95b',
  'qwq-plus',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen-omni-turbo',
  'qwen3-coder-plus',
  'qwen3-coder-flash',
  'qwen3-coder-480b-a35b-instruct',
  'qwen3-coder-30b-a3b-instruct'
]

/**
 * Chat `enable_search` eligibility per the QwenCloud web-search supported-models table; omni
 * lines ride the multimodal API. Prefixes hit canonical ids, so dated snapshots and `-preview` fold in.
 */
const webSearchModelPrefixes = [
  'qwen3-8-max',
  'qwen3-8-2-4t-a95b',
  'qwen3-7-max',
  'qwen3-7-plus',
  'qwen3-7-flash',
  'qwen3-6-plus',
  'qwen3-6-flash',
  'qwen3-5-plus',
  'qwen3-5-flash',
  'qwen3-max'
]

/**
 * Responses `web_search` tool lines from the same table — a CLOSED id list, not a family prefix:
 * `deepseek-v4` would also claim flash-vision-exp and `glm-5-2` the -fast variant, neither of
 * which the docs serve search on. Dated snapshots pro-0813/flash-0731 are listed upstream but
 * absent from the catalog; append them here once models.dev carries them.
 */
const responsesSearchModelIds = ['deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5-2']

export default defineProvider({
  id: 'qwencloud',
  // Chat Completions stays the provider default: it is the fallback for every model that arrives without
  // `endpointTypes`, and no per-model Responses support list is published for QwenCloud yet.
  name: 'QwenCloud',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/apps/anthropic'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  // Strategy tiers stay per model: `getWebSearchParams` narrows `search_strategy` by the same table.
  // Two declarations split the serving scope by endpoint: qwen3.x lines search via Chat's
  // enable_search, the DeepSeek/GLM ids via the Responses `web_search` tool only ("Responses API
  // only" in the docs table) — pinning Chat on those models drops the server side instead of
  // silently sending no search.
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: webSearchModelPrefixes,
      endpointTypes: ['openai-chat-completions']
    },
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIds: responsesSearchModelIds,
      endpointTypes: ['openai-responses']
    }
  ],
  metadata: {
    website: {
      apiKey: 'https://home.qwencloud.com/api-keys',
      docs: 'https://docs.qwencloud.com/developer-guides/getting-started/introduction',
      models: 'https://www.qwencloud.com/models',
      official: 'https://www.qwencloud.com/'
    }
  },
  overrides: [
    ...qwenChatModels.map(
      (modelId): Partial<ProviderModelOverride> => ({
        modelId,
        reasoningContracts: {
          'openai-chat-completions': { wire: qwenChatWire }
        }
      })
    ),
    ...highMaxModels.map(
      (modelId): Partial<ProviderModelOverride> => ({
        modelId,
        reasoningContracts: {
          'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
        }
      })
    ),
    {
      apiModelId: 'qwen3.8-max',
      modelId: 'qwen3-8-max',
      name: 'Qwen3.8 Max',
      reasoningContracts: {
        'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire }
      }
    },
    {
      apiModelId: 'qwen3.8-max-preview',
      modelId: 'qwen3-8-max-preview',
      name: 'Qwen3.8 Max Preview',
      reasoningContracts: {
        'openai-chat-completions': { support: qwen38PreviewSupport, wire: qwen38PreviewChatWire }
      }
    },
    {
      modelId: 'kimi-k3',
      reasoningContracts: {
        'openai-chat-completions': { support: kimiK3Support, wire: effortChatWire }
      }
    },
    // DeepSeek-V4 / GLM-5.2 search through the Responses `web_search` tool only — Responses stays the
    // default endpoint so their search is reachable, Chat remains selectable for plain requests.
    ...(['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5.2'] as const).map(
      (modelId): Partial<ProviderModelOverride> => ({
        modelId,
        endpointTypes: ['openai-responses', 'openai-chat-completions'],
        reasoningContracts: {
          'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
        }
      })
    ),
    ...listedModels.map((modelId): Partial<ProviderModelOverride> => ({ modelId }))
  ]
})
