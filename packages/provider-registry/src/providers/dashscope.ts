import type { ReasoningSupport } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'

const qwenChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  auto: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { missing: { type: 'omit-value' } }
  },
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { missing: { type: 'omit-value' } }
  }
}

const responsesEffortWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }] },
  auto: {
    operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
    // Bailian's own default is `xhigh`; map `auto` onto it rather than downgrading to medium.
    effortMap: { auto: 'xhigh' }
  },
  effort: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }] }
}

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

const qwen38Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'], default: 'xhigh' }],
  defaultEffort: 'xhigh',
  supportedEfforts: ['none', 'low', 'medium', 'xhigh'],
  thinkingTokenLimits: { min: 0, max: 262_144 }
}

const highMaxSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }],
  defaultEffort: 'high',
  supportedEfforts: ['none', 'high', 'max']
}

const kimiK3Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'max'], default: 'max' }],
  defaultEffort: 'max',
  supportedEfforts: ['none', 'max']
}

const effortChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] }
}

const qwen38ChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'reasoning_effort', value: { source: 'literal', value: 'none' } }] },
  effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] }
}

const minimaxM3Wire: ReasoningWireProfile = {
  off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
  auto: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }] },
  effort: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }] }
}

const qwenChatModels = [
  'qwen-plus',
  'qwen-flash',
  'qwen-turbo',
  'qwen3-14b',
  'qwen3-32b',
  'qwen3-235b-a22b',
  'qwen3-5-9b',
  'qwen3-5-27b',
  'qwen3-5-35b-a3b',
  'qwen3-5-122b-a10b',
  'qwen3-5-397b-a17b',
  'qwen3-5-flash',
  'qwen3-5-plus',
  'qwen3-6-27b',
  'qwen3-6-35b-a3b',
  'qwen3-6-flash',
  'qwen3-6-plus',
  'qwen3-6-max-preview',
  'qwen3-7-plus',
  'qwen3-7-max',
  'qwen3-max',
  'qwen3-omni-flash',
  'qwen3-vl',
  'qwen3-vl-plus',
  'qwen3-vl-8b',
  'qwen3-vl-30b-a3b',
  'qwen3-vl-235b-a22b'
]

/**
 * SKUs for which Bailian serves built-in web search, transcribed from the vendor's 支持的模型 matrix
 * (help.aliyun.com/zh/model-studio/web-search). A Bailian-platform serving feature, so it rides the
 * provider (not the alibaba creator). Chat-endpoint models get it via `enable_search`/`search_options`
 * params (getWebSearchParams); responses-endpoint models get the native `{type:'web_search'}` tool.
 *
 * Deliberately NOT the whole `qwenChatModels` list: the open-weight dense/MoE SKUs (qwen3-14b/32b/235b,
 * the qwen3.5/3.6 `-*b` variants), the qwen3-vl line, and qwen3-omni-flash are absent from that matrix,
 * so tagging them would light up the composer toggle only to yield vendor errors or empty results.
 */
const webSearchModels = new Set([
  // 千问 Max / Plus / Flash / Turbo / QwQ / 角色扮演
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
  // 第三方模型 (Bailian-hosted)
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v3-2',
  'deepseek-v3-1',
  'deepseek-r1',
  'deepseek-v3',
  'kimi-k2',
  'minimax-m2-1'
])

/**
 * SKUs Bailian serves over the Responses API (help.aliyun.com/zh/model-studio model support list).
 * Tracked separately from `webSearchModels` — the two vendor matrices do not coincide.
 */
const responsesModels = new Set([
  'qwen-plus',
  'qwen-flash',
  'qwen-plus-character',
  'qwen3-5-27b',
  'qwen3-5-35b-a3b',
  'qwen3-5-122b-a10b',
  'qwen3-5-397b-a17b',
  'qwen3-5-flash',
  'qwen3-5-plus',
  'qwen3-6-35b-a3b',
  'qwen3-6-flash',
  'qwen3-6-plus',
  'qwen3-7-plus',
  'qwen3-7-max',
  'qwen3-max',
  'qwen3-8-max-preview'
])

/** Newest qwen served ONLY via the Responses API — Chat Completions errors (仅 Responses API 支持). */
const responsesOnlyModels = new Set(['qwen3-7-max', 'qwen3-6-plus', 'qwen3-6-flash', 'qwen3-8-max-preview'])

/**
 * Dual-endpoint SKUs whose built-in search only works on Chat Completions. Bailian serves the Responses
 * `web_search` tool for the Qwen3.x line only ("Responses API 仅支持 Qwen3.7 Max系列、Qwen3.6、Qwen3.5、
 * qwen3-max"), while these aliases search via `enable_search` on Chat. Order Chat first so the default
 * endpoint is the one where their search actually works; Responses stays selectable.
 */
const chatWebSearchOnlyModels = new Set(['qwen-plus', 'qwen-flash', 'qwen-plus-character'])

const webSearchCapability = { capabilities: { add: ['web-search' as const] } }

/**
 * Per-model endpoint routing. The provider default stays Chat Completions, because endpoint selection
 * falls back to it for any model without `endpointTypes` — user-added custom models and models fetched
 * from `/models` that miss an override included. Only SKUs confirmed to serve Responses opt in here:
 * responses-only ones are pinned, dual-support ones list Responses first so it is preferred while Chat
 * Completions stays selectable. Everything else inherits the safe chat default.
 */
const endpointPin = (modelId: string): Partial<ProviderModelOverride> =>
  responsesOnlyModels.has(modelId)
    ? { endpointTypes: ['openai-responses'] }
    : chatWebSearchOnlyModels.has(modelId)
      ? { endpointTypes: ['openai-chat-completions', 'openai-responses'] }
      : responsesModels.has(modelId)
        ? { endpointTypes: ['openai-responses', 'openai-chat-completions'] }
        : {}

const qwenReasoningOverrides: Partial<ProviderModelOverride>[] = qwenChatModels.map((modelId) => ({
  modelId,
  ...(webSearchModels.has(modelId) ? webSearchCapability : {}),
  ...endpointPin(modelId),
  reasoningContracts: {
    'openai-chat-completions': { wire: qwenChatWire },
    'openai-responses': { support: qwenResponsesSupport, wire: responsesEffortWire }
  }
}))

const endpointReasoningOverrides: Partial<ProviderModelOverride>[] = [
  ...qwenReasoningOverrides,
  {
    apiModelId: 'qwen3.8-max-preview',
    modelId: 'qwen3-8-max-preview',
    name: 'Qwen3.8 Max Preview',
    ...webSearchCapability,
    ...endpointPin('qwen3-8-max-preview'),
    reasoningContracts: {
      'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
      'openai-responses': { support: qwen38Support, wire: responsesEffortWire }
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
  ...['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5', 'glm-5-1', 'glm-5-2'].map((modelId) => ({
    modelId,
    ...(webSearchModels.has(modelId) ? webSearchCapability : {}),
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
  ).map((row) => ({ ...row, ...webSearchCapability, ...endpointPin(row.modelId) }))
]

export default defineProvider({
  id: 'dashscope',
  // Chat Completions stays the provider default: it is the fallback for every model that arrives without
  // `endpointTypes` (custom models, `/models` discoveries with no override), and Bailian serves it far
  // more widely than Responses. Responses is opted into per model via `endpointPin`.
  name: 'Bailian',
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
  metadata: {
    website: {
      apiKey: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
      docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
      models: 'https://bailian.console.aliyun.com/?tab=model#/model-market',
      official: 'https://www.aliyun.com/product/bailian'
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
            supports: {
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
            },
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
            supports: {
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
            },
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
            supports: {
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
            },
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
