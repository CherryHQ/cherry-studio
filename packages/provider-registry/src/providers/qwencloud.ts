import type { ImageModeDef } from '../schemas/model'
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

/**
 * qwen-image-2.0 lines ride the same sync multimodal transport with a fixed 2048x2048 default
 * (no `auto`); on editing the upstream default is the input image's resolution instead.
 */
const qwenImage20Mode: ImageModeDef = {
  supports: {
    addWatermark: { default: false, type: 'switch' },
    negativePrompt: { multiline: true, type: 'text' },
    numImages: { default: 1, max: 6, min: 1, type: 'range' },
    promptExtend: { default: true, type: 'switch' },
    seed: { type: 'text' },
    size: {
      default: '2048x2048',
      options: ['2048x2048', '1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
      render: 'chips',
      type: 'enum'
    }
  },
  vendorTransport: { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
}

const qwenImage20ImageGeneration = { modes: { edit: qwenImage20Mode, generate: qwenImage20Mode } }

/** z-image-turbo is t2i-only on the same sync transport; prompt rewriting defaults off upstream. */
const zImageTurboMode: ImageModeDef = {
  supports: {
    promptExtend: { default: false, type: 'switch' },
    seed: { type: 'text' },
    size: {
      default: '1024x1536',
      options: ['1024x1536', '1536x1024', '1024x1024', '1152x768', '768x1152'],
      render: 'chips',
      type: 'enum'
    }
  },
  vendorTransport: { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
}

/** wan2.7 lines take t2i and editing (0-9 reference images) on one async endpoint with one parameter set. */
const wan27Supports: ImageModeDef['supports'] = {
  addWatermark: { default: false, type: 'switch' },
  imageResolution: { default: '2K', options: ['1K', '2K'], render: 'chips', type: 'enum' },
  numImages: { default: 1, max: 4, min: 1, type: 'range' },
  seed: { type: 'text' },
  thinkingMode: { default: true, type: 'switch' }
}

/** Only `-pro` reaches 4K. */
const wan27ProSupports: ImageModeDef['supports'] = {
  ...wan27Supports,
  imageResolution: { default: '2K', options: ['1K', '2K', '4K'], render: 'chips', type: 'enum' }
}

const wan27Endpoint = { endpoint: '/api/v1/services/aigc/image-generation/generation' }

const wan27ImageGeneration = {
  modes: {
    edit: { supports: wan27Supports, vendorTransport: wan27Endpoint },
    generate: { supports: wan27Supports, vendorTransport: wan27Endpoint }
  }
}

const wan27ProImageGeneration = {
  modes: {
    edit: { supports: wan27ProSupports, vendorTransport: wan27Endpoint },
    generate: { supports: wan27ProSupports, vendorTransport: wan27Endpoint }
  }
}

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
    ...listedModels.map((modelId): Partial<ProviderModelOverride> => ({ modelId })),
    /**
     * Image SKUs per the QwenCloud image-models catalog (docs.qwencloud.com): sync multimodal
     * qwen-image-2.x/3.x + z-image lines, legacy async wan/qwen-image SKUs shared with the mainland
     * provider. Mainland-only lines (qwen-mt-image, wanx*) are absent internationally and stay out.
     * Blocks restate the full `imageGeneration` — the runtime replaces it wholesale.
     */
    { apiModelId: 'qwen-image-3.0', imageGeneration: qwenImage3ImageGeneration, modelId: 'qwen-image-3-0' },
    { apiModelId: 'qwen-image-3.0-pro', imageGeneration: qwenImage3ImageGeneration, modelId: 'qwen-image-3-0-pro' },
    {
      apiModelId: 'qwen-image-2.0-pro',
      capabilities: { force: ['image-generation'] },
      imageGeneration: qwenImage20ImageGeneration,
      inputModalities: ['text', 'image'],
      modelId: 'qwen-image-2-0-pro',
      name: 'Qwen Image 2.0 Pro',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'qwen-image-2.0',
      capabilities: { force: ['image-generation'] },
      imageGeneration: qwenImage20ImageGeneration,
      inputModalities: ['text', 'image'],
      modelId: 'qwen-image-2-0',
      name: 'Qwen Image 2.0',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
    },
    {
      apiModelId: 'z-image-turbo',
      capabilities: { force: ['image-generation'] },
      imageGeneration: { modes: { generate: zImageTurboMode } },
      inputModalities: ['text'],
      modelId: 'z-image-turbo',
      name: 'Z-Image Turbo',
      outputModalities: ['image'],
      ownedBy: 'alibaba'
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
            vendorTransport: {
              endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
              isSync: true
            }
          }
        }
      },
      modelId: 'qwen-image-edit'
    },
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
      apiModelId: 'wan2.7-image-pro',
      imageGeneration: wan27ProImageGeneration,
      modelId: 'wan2-7-image-pro'
    },
    { apiModelId: 'wan2.7-image', imageGeneration: wan27ImageGeneration, modelId: 'wan2-7-image' },
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
    }
  ]
})
