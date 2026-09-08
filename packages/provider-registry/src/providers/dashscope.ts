import type { ImageModeDef, ReasoningSupport } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
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
import { EFFORT, modeWire } from './wires'

const webSearchModelPrefixes = [
  'qwen3-8-flash',
  'qwen3-8-max',
  'qwen3-8-max-preview',
  'qwen3-7-max',
  'qwen3-6-max-preview',
  'qwen3-max',
  'qwen3-7-plus',
  'qwen3-6-plus',
  'qwen3-5-plus',
  'qwen-plus',
  'qwen3-6-flash',
  'qwen3-5-flash',
  'qwen-flash',
  'qwen-turbo',
  'qwq-plus',
  'qwen-plus-character',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v3-2',
  'deepseek-v3-1',
  'deepseek-r1',
  'deepseek-v3',
  'kimi-k2',
  'kimi-k3',
  'kimi-latest',
  'glm-4',
  'glm-5'
]

// Web-extractor (help.aliyun.com/zh/model-studio/web-extractor) is served for the Qwen Max/Plus/Flash
// lines only — a subset of the web-search models (no DeepSeek/Kimi/GLM/QwQ/turbo). Extraction rides web
// search, so eligibility here also gates the chat `agent_max` strategy in getWebSearchParams.
const webExtractorModelPrefixes = [
  'qwen3-8-flash',
  'qwen3-8-max',
  'qwen3-8-max-preview',
  'qwen3-7-max',
  'qwen3-6-max-preview',
  'qwen3-max',
  'qwen3-7-plus',
  'qwen3-6-plus',
  'qwen3-5-plus',
  'qwen-plus',
  'qwen3-6-flash',
  'qwen3-5-flash',
  'qwen-flash'
]

/** wanx2.x text-to-image SKUs share one parameter set on DashScope's async t2i transport. */
const wanxT2iSupports: ImageModeDef['supports'] = {
  addWatermark: { default: false, type: 'switch' },
  negativePrompt: { multiline: true, type: 'text' },
  numImages: { default: 1, max: 4, min: 1, type: 'range' },
  promptExtend: { default: true, type: 'switch' },
  seed: { type: 'text' },
  size: {
    default: '1024x1024',
    options: ['1024x1024', '1280x720', '720x1280', '1440x720', '720x1440'],
    render: 'chips',
    type: 'enum'
  }
}

/** qwen-image-3.0 / -pro serve both t2i and editing off one sync multimodal endpoint. */
const qwenImage3Mode: ImageModeDef = {
  supports: {
    addWatermark: { default: false, type: 'switch' },
    negativePrompt: { multiline: true, type: 'text' },
    numImages: { default: 1, max: 6, min: 1, type: 'range' },
    promptExtend: { default: true, type: 'switch' },
    seed: { type: 'text' },
    size: {
      default: 'auto',
      options: ['auto', '1328x1328', '1664x928', '928x1664', '1472x1140', '1140x1472'],
      render: 'chips',
      type: 'enum'
    }
  },
  vendorTransport: { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
}

const qwenImage3ImageGeneration = { modes: { edit: qwenImage3Mode, generate: qwenImage3Mode } }

const responsesEffortWire = modeWire(
  'reasoningEffort',
  { off: 'none', auto: EFFORT, effort: EFFORT },
  { autoEffort: 'xhigh' }
)

/**
 * Bailian's Responses API controls reasoning via `reasoning.effort` — seven tiers
 * (none/minimal/low/medium/high/xhigh/max) defaulting to `xhigh`; `thinking_budget` is NOT supported
 * there and `enable_thinking` is being retired
 * (help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses). Mirror the vendor default instead of
 * pinning a lower tier, so leaving reasoning unset doesn't silently weaken it. The chat contract keeps
 * qwen's native toggle + thinking_budget.
 *
 * `xhigh`/`max` are only served by 华北2（北京）and 新加坡; this provider's baseUrl is the Beijing host.
 */
const qwenResponsesSupport: ReasoningSupport = {
  controls: [
    { kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'xhigh' }
  ],
  defaultEffort: 'xhigh',
  supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
}

/** `qwen3.8-max-preview` serves thinking mode only, so its Responses contract drops the `'none'` tier. */
const qwenResponsesThinkingOnlySupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'xhigh' }],
  defaultEffort: 'xhigh',
  supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
}

const qwen38PreviewResponsesWire: ReasoningWireProfile = modeWire(
  'reasoningEffort',
  { auto: EFFORT, effort: EFFORT },
  { autoEffort: 'xhigh' }
)

const minimaxM3Wire: ReasoningWireProfile = modeWire('thinking.type', {
  off: 'disabled',
  auto: 'adaptive',
  effort: 'adaptive'
})

const qwenChatModels = [
  'qwen-plus',
  'qwen-flash',
  'qwen-turbo',
  'qwen3-14b',
  'qwen3-32b',
  'qwen3-235b-a22b',
  'qwen3.5-9b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3.5-122b-a10b',
  'qwen3.5-397b-a17b',
  'qwen3.5-flash',
  'qwen3.5-plus',
  'qwen3.6-27b',
  'qwen3.6-35b-a3b',
  'qwen3.6-flash',
  'qwen3.6-plus',
  'qwen3.6-max-preview',
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3-max',
  'qwen3-omni-flash',
  'qwen3-vl',
  'qwen3-vl-plus',
  'qwen3-vl-8b',
  'qwen3-vl-30b-a3b',
  'qwen3-vl-235b-a22b'
]

/**
 * SKUs Bailian serves over the Responses API (help.aliyun.com/zh/model-studio model support list).
 */
const responsesModels = new Set([
  'qwen-plus',
  'qwen-flash',
  'qwen-plus-character',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3.5-122b-a10b',
  'qwen3.5-397b-a17b',
  'qwen3.5-flash',
  'qwen3.5-plus',
  'qwen3.6-35b-a3b',
  'qwen3.6-flash',
  'qwen3.6-plus',
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3-max',
  'qwen3.8-flash',
  'qwen3.8-max',
  'qwen3.8-max-preview'
])

/**
 * Dual-endpoint SKUs whose built-in search only works on Chat Completions. Bailian serves the Responses
 * `web_search` tool for the Qwen3.x line only ("Responses API 仅支持 Qwen3.7 Max系列、Qwen3.6、Qwen3.5、
 * qwen3-max"), while these aliases search via `enable_search` on Chat. Order Chat first so the default
 * endpoint is the one where their search actually works; Responses stays selectable.
 */
const chatWebSearchOnlyModels = new Set(['qwen-plus', 'qwen-flash', 'qwen-plus-character'])

/**
 * Per-model endpoint routing. The provider default stays Chat Completions, because endpoint selection
 * falls back to it for any model without `endpointTypes` — user-added custom models and models fetched
 * from `/models` that miss an override included. Only SKUs confirmed to serve Responses opt in here,
 * and every one of them keeps Chat Completions as a second, selectable endpoint: Bailian serves the
 * whole qwen line on Chat (help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions lists
 * qwen3.7-max / qwen3.6-plus / qwen3.6-flash / qwen3.8-max-preview among others), so NO model is
 * Responses-only. The per-endpoint split is about which mechanism serves built-in web search, not about
 * model availability — see `chatWebSearchOnlyModels` and `servesResponsesWebSearch` in
 * `src/main/ai/utils/websearch.ts`. Everything else inherits the safe chat default.
 */
const endpointPin = (modelId: string): Partial<ProviderModelOverride> =>
  chatWebSearchOnlyModels.has(modelId)
    ? { endpointTypes: ['openai-chat-completions', 'openai-responses'] }
    : responsesModels.has(modelId)
      ? { endpointTypes: ['openai-responses', 'openai-chat-completions'] }
      : {}

const qwenReasoningOverrides: Partial<ProviderModelOverride>[] = qwenChatModels.map((modelId) => ({
  modelId,
  ...endpointPin(modelId),
  reasoningContracts: {
    'openai-chat-completions': { wire: qwenChatWire },
    'openai-responses': { support: qwenResponsesSupport, wire: responsesEffortWire }
  }
}))

const endpointReasoningOverrides: Partial<ProviderModelOverride>[] = [
  ...qwenReasoningOverrides,
  {
    apiModelId: 'qwen3.8-flash',
    modelId: 'qwen3-8-flash',
    name: 'Qwen3.8 Flash',
    ...endpointPin('qwen3.8-flash'),
    reasoningContracts: {
      'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
      'openai-responses': { support: qwenResponsesSupport, wire: responsesEffortWire }
    }
  },
  {
    apiModelId: 'qwen3.8-max',
    modelId: 'qwen3-8-max',
    name: 'Qwen3.8 Max',
    ...endpointPin('qwen3.8-max'),
    reasoningContracts: {
      'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
      'openai-responses': { support: qwenResponsesSupport, wire: responsesEffortWire }
    }
  },
  {
    apiModelId: 'qwen3.8-max-preview',
    modelId: 'qwen3-8-max-preview',
    name: 'Qwen3.8 Max Preview',
    ...endpointPin('qwen3.8-max-preview'),
    reasoningContracts: {
      'openai-chat-completions': { support: qwen38PreviewSupport, wire: qwen38PreviewChatWire },
      'openai-responses': { support: qwenResponsesThinkingOnlySupport, wire: qwen38PreviewResponsesWire }
    }
  },
  {
    modelId: 'minimax-m3',
    ...endpointPin('minimax-m3'),
    reasoningContracts: {
      'openai-chat-completions': {
        support: { controls: [{ kind: 'toggle', default: true }] },
        wire: minimaxM3Wire
      }
    }
  },
  ...['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5', 'glm-5.1', 'glm-5.2'].map((modelId) => ({
    modelId,
    ...endpointPin(modelId),
    reasoningContracts: {
      'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
    }
  })),
  {
    apiModelId: 'kimi/kimi-k3',
    modelId: 'kimi-k3',
    ...endpointPin('kimi-k3'),
    reasoningContracts: {
      'openai-chat-completions': { support: kimiK3Support, wire: effortChatWire }
    }
  },
  // Web-search rows for SKUs with no reasoning contract above. Bailian's wire ids keep the vendor's dots
  // and casing, while catalog `modelId`s are normalized — so carry an explicit `apiModelId` wherever the
  // two differ, otherwise the request would send the normalized spelling and fail.
  // (`qwen-flash-character` / `qwen3.5-ocr` are not in the catalog yet — skipped.)
  ...(
    [
      { modelId: 'qwq-plus' },
      { modelId: 'qwen-plus-character' },
      { modelId: 'deepseek-r1' },
      { modelId: 'deepseek-v3' },
      { apiModelId: 'deepseek-v3.2', modelId: 'deepseek-v3-2' },
      { apiModelId: 'deepseek-v3.1', modelId: 'deepseek-v3-1' },
      { apiModelId: 'Moonshot-Kimi-K2-Instruct', modelId: 'kimi-k2' },
      { apiModelId: 'MiniMax-M2.1', modelId: 'minimax-m2-1' }
    ] satisfies Partial<ProviderModelOverride>[]
  ).map((row) => ({ ...row, ...endpointPin(row.modelId) }))
]

export default defineProvider({
  id: 'dashscope',
  // Chat Completions stays the provider default: it is the fallback for every model that arrives without
  // `endpointTypes` (custom models, `/models` discoveries with no override), and Bailian serves it far
  // more widely than Responses. Responses is opted into per model via `endpointPin`.
  // Rebranded to Qwen AI Platform (mainland China); the 'dashscope' id and endpoints stay
  // unchanged so existing users' keys and configs keep working (ref #18432).
  name: 'Qwen AI Platform',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      reasoningFormat: { type: 'openai-responses' }
    }
  },
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: webSearchModelPrefixes,
      modelIds: ['minimax-m2-1']
    },
    {
      id: 'url-context',
      modelScope: 'model-dependent',
      modelIdPrefixes: webExtractorModelPrefixes
    }
  ],
  metadata: {
    website: {
      apiKey: 'https://platform.qianwenai.com/home/api-keys',
      docs: 'https://platform.qianwenai.com/docs/developer-guides/getting-started/first-api-call',
      models: 'https://www.qianwenai.com/models',
      official: 'https://www.qianwenai.com/'
    }
  },
  overrides: [
    ...endpointReasoningOverrides,
    {
      apiModelId: 'qwen-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              promptExtend: { default: true, type: 'switch' },
              seed: { type: 'text' },
              size: {
                default: '1328x1328',
                options: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
          }
        }
      },
      modelId: 'qwen-image'
    },
    {
      apiModelId: 'qwen-image-3.0',
      imageGeneration: qwenImage3ImageGeneration,
      modelId: 'qwen-image-3-0'
    },
    {
      apiModelId: 'qwen-image-3.0-pro',
      imageGeneration: qwenImage3ImageGeneration,
      modelId: 'qwen-image-3-0-pro'
    },
    {
      apiModelId: 'qwen-image-edit',
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              negativePrompt: { multiline: true, type: 'text' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
          }
        }
      },
      modelId: 'qwen-image-edit'
    },
    {
      apiModelId: 'qwen-mt-image',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          edit: {
            requirePrompt: false,
            supports: {
              sourceLang: {
                default: 'auto',
                options: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'es', 'ru', 'de'],
                type: 'enum'
              },
              targetLang: { default: 'en', options: ['en', 'zh', 'ja', 'ko', 'fr', 'es', 'ru', 'de'], type: 'enum' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['image'],
      modelId: 'qwen-mt-image',
      name: 'Qwen MT Image',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wan2.5-i2i-preview',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              promptExtend: { default: true, type: 'switch' },
              seed: { type: 'text' },
              size: {
                default: '1280x1280',
                options: ['1280x1280', '1024x1024', '1664x928', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text', 'image'],
      modelId: 'wan2-5-i2i-preview',
      name: 'Wan 2.5 i2i Preview',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wan2.6-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              enableInterleave: { default: true, type: 'switch' },
              imageResolution: { default: '1K', options: ['1K', '2K'], render: 'chips', type: 'enum' },
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              promptExtend: { default: true, type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image-generation/generation' }
          }
        }
      },
      modelId: 'wan2-6-image'
    },
    {
      apiModelId: 'wan2.7-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              imageResolution: { default: '2K', options: ['1K', '2K'], render: 'chips', type: 'enum' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              seed: { type: 'text' },
              thinkingMode: { default: true, type: 'switch' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image-generation/generation' }
          }
        }
      },
      modelId: 'wan2-7-image'
    },
    {
      apiModelId: 'wan2.7-image-pro',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              imageResolution: { default: '2K', options: ['1K', '2K', '4K'], render: 'chips', type: 'enum' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              seed: { type: 'text' },
              thinkingMode: { default: true, type: 'switch' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image-generation/generation' }
          }
        }
      },
      modelId: 'wan2-7-image-pro'
    },
    {
      apiModelId: 'wanx-v1',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              refMode: { default: 'repaint', options: ['repaint', 'refonly'], type: 'enum' },
              refStrength: { default: 0.5, max: 1, min: 0, step: 0.05, type: 'range' },
              seed: { type: 'text' },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '720x1280', '1280x720', '768x1152'],
                render: 'chips',
                type: 'enum'
              },
              style: {
                default: '<auto>',
                options: [
                  '<auto>',
                  '<photography>',
                  '<portrait>',
                  '<3d cartoon>',
                  '<anime>',
                  '<oil painting>',
                  '<watercolor>',
                  '<sketch>',
                  '<chinese painting>',
                  '<flat illustration>'
                ],
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text', 'image'],
      modelId: 'wanx-v1',
      name: 'Wanx v1',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wanx2.0-t2i-turbo',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          generate: {
            supports: wanxT2iSupports,
            vendorTransport: { endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text'],
      modelId: 'wanx2-0-t2i-turbo',
      name: 'Wanx 2.0 T2I Turbo',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wanx2.1-imageedit',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              bottomScale: { default: 1, max: 2, min: 1, step: 0.05, type: 'range' },
              function: {
                default: 'stylization_all',
                options: [
                  'stylization_all',
                  'stylization_local',
                  'description_edit',
                  'description_edit_with_mask',
                  'remove_watermark',
                  'expand',
                  'super_resolution',
                  'colorization',
                  'doodle',
                  'control_cartoon_feature'
                ],
                type: 'enum'
              },
              isSketch: { default: false, type: 'switch' },
              leftScale: { default: 1, max: 2, min: 1, step: 0.05, type: 'range' },
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              rightScale: { default: 1, max: 2, min: 1, step: 0.05, type: 'range' },
              seed: { type: 'text' },
              strength: { default: 0.5, max: 1, min: 0, step: 0.05, type: 'range' },
              topScale: { default: 1, max: 2, min: 1, step: 0.05, type: 'range' },
              upscaleFactor: { default: 2, max: 4, min: 1, step: 1, type: 'range' }
            },
            vendorTransport: { endpoint: '/api/v1/services/aigc/image2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text', 'image'],
      modelId: 'wanx2-1-imageedit',
      name: 'Wanx 2.1 Image Edit',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wanx2.1-t2i-plus',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          generate: {
            supports: wanxT2iSupports,
            vendorTransport: { endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text'],
      modelId: 'wanx2-1-t2i-plus',
      name: 'Wanx 2.1 T2I Plus',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'wanx2.1-t2i-turbo',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          generate: {
            supports: wanxT2iSupports,
            vendorTransport: { endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
          }
        }
      },
      inputModalities: ['text'],
      modelId: 'wanx2-1-t2i-turbo',
      name: 'Wanx 2.1 T2I Turbo',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    }
  ]
})
