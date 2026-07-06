import { defineProvider } from './types'

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
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
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
