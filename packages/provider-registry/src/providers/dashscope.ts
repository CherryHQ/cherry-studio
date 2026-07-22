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
    effortMap: { auto: 'medium' }
  },
  effort: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }] }
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
  'qwen3-coder',
  'qwen3-coder-next',
  'qwen3-max',
  'qwen3-omni-flash',
  'qwen3-vl',
  'qwen3-vl-plus',
  'qwen3-vl-8b',
  'qwen3-vl-30b-a3b',
  'qwen3-vl-235b-a22b'
]

const qwenReasoningOverrides: Partial<ProviderModelOverride>[] = qwenChatModels.map((modelId) => ({
  modelId,
  reasoningContracts: {
    'openai-chat-completions': { wire: qwenChatWire },
    'openai-responses': { wire: responsesEffortWire }
  }
}))

const endpointReasoningOverrides: Partial<ProviderModelOverride>[] = [
  ...qwenReasoningOverrides,
  {
    apiModelId: 'qwen3.8-max-preview',
    modelId: 'qwen3-8-max-preview',
    name: 'Qwen3.8 Max Preview',
    reasoningContracts: {
      'openai-chat-completions': { support: qwen38Support, wire: qwen38ChatWire },
      'openai-responses': { support: qwen38Support, wire: responsesEffortWire }
    }
  },
  {
    modelId: 'minimax-m3',
    reasoningContracts: {
      'openai-chat-completions': {
        support: { controls: [{ kind: 'toggle', default: true }] },
        wire: minimaxM3Wire
      }
    }
  },
  ...['deepseek-v4-pro', 'deepseek-v4-flash', 'glm-5', 'glm-5-1', 'glm-5-2'].map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { support: highMaxSupport, wire: effortChatWire }
    }
  })),
  {
    apiModelId: 'kimi/kimi-k3',
    modelId: 'kimi-k3',
    reasoningContracts: {
      'openai-chat-completions': { support: kimiK3Support, wire: effortChatWire }
    }
  }
]

export default defineProvider({
  id: 'dashscope',
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
