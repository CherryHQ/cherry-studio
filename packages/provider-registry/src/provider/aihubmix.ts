import { defineProvider } from './types'

export default defineProvider({
  id: 'aihubmix',
  name: 'AiHubMix',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'aihubmix',
      baseUrl: 'https://aihubmix.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'aihubmix',
      baseUrl: 'https://aihubmix.com/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://aihubmix.com',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://aihubmix.com/models',
      official: 'https://aihubmix.com'
    }
  },
  overrides: [
    {
      modelId: 'flux-2-pro',
      apiModelId: 'flux-2-pro',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: { options: ['16:9', '1:1', '4:3'], default: '16:9', render: 'chips', type: 'enum' },
              safetyTolerance: { min: 0, max: 5, default: 2, type: 'range' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/bfl/flux-2-pro/predictions' }
          }
        }
      }
    },
    {
      modelId: 'flux-2-flex',
      apiModelId: 'flux-2-flex',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: { options: ['16:9', '1:1', '4:3'], default: '16:9', render: 'chips', type: 'enum' },
              safetyTolerance: { min: 0, max: 5, default: 2, type: 'range' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/bfl/flux-2-flex/predictions' }
          }
        }
      }
    },
    {
      modelId: 'qwen-image',
      apiModelId: 'qwen-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              size: {
                options: ['1024x1024', '768x1024', '1024x768', '512x1024', '1024x576', '576x1024'],
                default: '1024x1024',
                render: 'chips',
                type: 'enum'
              },
              numImages: { min: 1, max: 10, default: 1, type: 'range' },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/qianfan/qwen-image/predictions' }
          }
        }
      }
    },
    {
      modelId: 'qwen-image-edit',
      apiModelId: 'qwen-image-edit',
      inputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              size: {
                options: ['1024x1024', '768x1024', '1024x768', '512x1024', '1024x576', '576x1024'],
                default: '1024x1024',
                render: 'chips',
                type: 'enum'
              },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/qianfan/qwen-image-edit/predictions' }
          }
        }
      }
    },
    {
      modelId: 'doubao-seedream-4-0',
      apiModelId: 'doubao-seedream-4-0',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              size: { options: ['1K', '2K', '4K'], default: '2K', render: 'chips', type: 'enum' },
              sequentialImageGeneration: { type: 'switch' },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/doubao/doubao-seedream-4-0/predictions' }
          }
        }
      }
    },
    {
      modelId: 'doubao-seedream-4-5',
      apiModelId: 'doubao-seedream-4-5',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              size: { options: ['1K', '2K', '4K'], default: '2K', render: 'chips', type: 'enum' },
              sequentialImageGeneration: { type: 'switch' },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/doubao/doubao-seedream-4-5/predictions' }
          }
        }
      }
    },
    {
      modelId: 'imagen-4-0-ultra-generate-001',
      apiModelId: 'imagen-4.0-ultra-generate-001',
      imageGeneration: {
        modes: {
          generate: {
            supports: { numImages: { min: 1, max: 4, default: 1, type: 'range' } },
            vendorTransport: { endpoint: '/v1/models/google/imagen-4.0-ultra-generate-001/predictions' }
          }
        }
      }
    },
    {
      modelId: 'imagen-4-0-generate-001',
      apiModelId: 'imagen-4.0-generate-001',
      imageGeneration: {
        modes: {
          generate: {
            supports: { numImages: { min: 1, max: 4, default: 1, type: 'range' } },
            vendorTransport: { endpoint: '/v1/models/google/imagen-4.0-generate-001/predictions' }
          }
        }
      }
    },
    {
      modelId: 'imagen-4-0-fast-generate-001',
      apiModelId: 'imagen-4.0-fast-generate-001',
      imageGeneration: {
        modes: {
          generate: {
            supports: { numImages: { min: 1, max: 4, default: 1, type: 'range' } },
            vendorTransport: { endpoint: '/v1/models/google/imagen-4.0-fast-generate-001/predictions' }
          }
        }
      }
    },
    {
      modelId: 'imagen-3-0-generate-002',
      name: 'Imagen 3.0',
      apiModelId: 'imagen-3.0-generate-002',
      imageGeneration: {
        modes: {
          generate: {
            supports: { numImages: { min: 1, max: 4, default: 1, type: 'range' } },
            vendorTransport: { endpoint: '/v1/models/google/imagen-3.0-generate-002/predictions' }
          }
        }
      }
    },
    {
      modelId: 'ideogram-v3',
      apiModelId: 'ideogram/V3',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              renderingSpeed: { options: ['DEFAULT', 'TURBO', 'QUALITY'], default: 'DEFAULT', type: 'enum' },
              aspectRatio: {
                options: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'],
                default: '1:1',
                render: 'chips',
                type: 'enum'
              },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/ideogram/V3/predictions' }
          }
        }
      }
    },
    {
      modelId: 'irag-1-0',
      name: 'Baidu iRAG 1.0',
      apiModelId: 'irag-1.0',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: { min: 1, max: 4, default: 1, type: 'range' },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/models/qianfan/irag-1.0/predictions' }
          }
        }
      }
    },
    {
      modelId: 'ernie-irag-edit',
      name: 'ERNIE iRAG Edit',
      apiModelId: 'ernie-irag-edit',
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: { seed: { type: 'text' } },
            vendorTransport: { endpoint: '/v1/models/qianfan/ernie-irag-edit/predictions' }
          }
        }
      }
    }
  ]
})
