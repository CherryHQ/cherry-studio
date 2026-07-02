import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'ppio',
  name: 'PPIO',
  baseUrl: 'https://api.ppinfra.com/v3/openai/',
  website: {
    apiKey: 'https://ppio.com/settings/key-management',
    docs: 'https://docs.cherry-ai.com/pre-basic/providers/ppio',
    models: 'https://ppio.com/model-api/product/llm-api',
    official: 'https://ppio.com/'
  },
  overrides: [
    {
      apiModelId: 'zai-org/autoglm-phone-9b-multilingual',
      limits: { maxOutputTokens: 32000 },
      modelId: 'autoglm-phone-multilingual',
      modelVariants: ['9b'],
      name: 'AutoGLM-Phone-9B-Multilingual',
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.25 }, output: { currency: 'CNY', perMillionTokens: 1 } }
    },
    {
      apiModelId: 'baai/bge-m3',
      endpointTypes: ['openai-embeddings'],
      limits: { contextWindow: 8192, maxOutputTokens: 16000 },
      modelId: 'bge-m3',
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.07 }, output: { currency: 'CNY', perMillionTokens: 0 } }
    },
    {
      apiModelId: 'deepseek/deepseek-r1-0528',
      limits: { contextWindow: 163840, maxOutputTokens: 32768 },
      modelId: 'deepseek-r1',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'deepseek/deepseek-r1-distill-llama-70b',
      limits: { contextWindow: 32000, maxOutputTokens: 8000 },
      modelId: 'deepseek-r1-distill-llama-70b',
      modelVariants: ['70b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 5.8 }, output: { currency: 'CNY', perMillionTokens: 5.8 } }
    },
    {
      apiModelId: 'deepseek/deepseek-v3.1',
      limits: { contextWindow: 131072, maxOutputTokens: 32768 },
      modelId: 'deepseek-v3-1',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 12 } }
    },
    {
      apiModelId: 'deepseek/deepseek-v3.1-terminus',
      limits: { contextWindow: 131072, maxOutputTokens: 65536 },
      modelId: 'deepseek-v3-1-terminus',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 12 } }
    },
    {
      apiModelId: 'deepseek/deepseek-v3.2',
      limits: { contextWindow: 163840, maxOutputTokens: 65536 },
      modelId: 'deepseek-v3-2',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 3 } }
    },
    {
      apiModelId: 'deepseek/deepseek-v3.2-exp',
      limits: { maxOutputTokens: 65536 },
      modelId: 'deepseek-v3-2-exp',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 3 } }
    },
    {
      apiModelId: 'baidu/ernie-4.5-vl-424b-a47b',
      modelId: 'ernie-4-5-vl-424b-a47b',
      modelVariants: ['424b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 3 }, output: { currency: 'CNY', perMillionTokens: 9 } }
    },
    {
      apiModelId: 'zai-org/glm-4.5',
      limits: { contextWindow: 131072 },
      modelId: 'glm-4-5',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'zai-org/glm-4.5-air',
      modelId: 'glm-4-5-air',
      pricing: { input: { currency: 'CNY', perMillionTokens: 1.2 }, output: { currency: 'CNY', perMillionTokens: 2 } }
    },
    {
      apiModelId: 'zai-org/glm-4.5v',
      limits: { contextWindow: 65536 },
      modelId: 'glm-4-5v',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 12 } }
    },
    {
      apiModelId: 'zai-org/glm-4.6',
      limits: { contextWindow: 204800 },
      modelId: 'glm-4-6',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'zai-org/glm-4.6v',
      limits: { contextWindow: 131072 },
      modelId: 'glm-4-6v',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 6 } }
    },
    {
      apiModelId: 'zai-org/glm-4.7',
      limits: { contextWindow: 204800 },
      modelId: 'glm-4-7',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'zai-org/glm-4.7-flash',
      limits: { maxOutputTokens: 128000 },
      modelId: 'glm-4-7-flash',
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.5 }, output: { currency: 'CNY', perMillionTokens: 3 } }
    },
    {
      apiModelId: 'zai-org/glm-5',
      limits: { contextWindow: 202800 },
      modelId: 'glm-5',
      pricing: { input: { currency: 'CNY', perMillionTokens: 6 }, output: { currency: 'CNY', perMillionTokens: 22 } }
    },
    {
      modelId: 'glm-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '1280x1280',
                options: ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/glm-image' }
          }
        }
      }
    },
    {
      apiModelId: 'moonshotai/kimi-k2-thinking',
      modelId: 'kimi-k2',
      modelVariants: ['thinking'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'moonshotai/kimi-k2.5',
      modelId: 'kimi-k2-5',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 21 } }
    },
    {
      apiModelId: 'moonshotai/kimi-k2-instruct',
      limits: { contextWindow: 131072, maxOutputTokens: 128000 },
      modelId: 'kimi-k2-instruct',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'xiaomimimo/mimo-v2-flash',
      limits: { contextWindow: 262144 },
      modelId: 'mimo-v2-flash',
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.7 }, output: { currency: 'CNY', perMillionTokens: 2.1 } }
    },
    {
      apiModelId: 'minimax/minimax-m2',
      limits: { contextWindow: 204800, maxOutputTokens: 131072 },
      modelId: 'minimax-m2',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2.1 }, output: { currency: 'CNY', perMillionTokens: 8.4 } }
    },
    {
      apiModelId: 'minimax/minimax-m2.1',
      limits: { contextWindow: 204800 },
      modelId: 'minimax-m2-1',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2.1 }, output: { currency: 'CNY', perMillionTokens: 8.4 } }
    },
    {
      apiModelId: 'minimax/minimax-m2.5',
      limits: { maxOutputTokens: 131100 },
      modelId: 'minimax-m2-5',
      pricing: { input: { currency: 'CNY', perMillionTokens: 2.1 }, output: { currency: 'CNY', perMillionTokens: 8.4 } }
    },
    {
      apiModelId: 'minimax/minimax-m2.5-highspeed',
      limits: { maxOutputTokens: 131100 },
      modelId: 'minimax-m2-5-highspeed',
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 4.2 },
        output: { currency: 'CNY', perMillionTokens: 16.8 }
      }
    },
    {
      apiModelId: 'qwen/qwen-2.5-72b-instruct',
      limits: { maxOutputTokens: 16000 },
      modelId: 'qwen-2-5-72b-instruct',
      modelVariants: ['72b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 12 } }
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { type: 'switch' },
              outputFormat: { options: ['jpeg', 'png', 'webp'], type: 'enum' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v3/async/qwen-image-edit-2509' }
          }
        }
      },
      modelId: 'qwen-image-edit'
    },
    {
      apiModelId: 'qwen/qwen2.5-7b-instruct',
      limits: { contextWindow: 32000, maxOutputTokens: 32000 },
      modelId: 'qwen2-5-7b-instruct',
      modelVariants: ['7b'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 0.35 },
        output: { currency: 'CNY', perMillionTokens: 0.35 }
      }
    },
    {
      apiModelId: 'qwen/qwen2.5-vl-72b-instruct',
      limits: { contextWindow: 32000, maxOutputTokens: 32000 },
      modelId: 'qwen2-5-vl-72b-instruct',
      modelVariants: ['72b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 4.2 }, output: { currency: 'CNY', perMillionTokens: 4.2 } }
    },
    {
      apiModelId: 'qwen/qwen3-235b-a22b-fp8',
      modelId: 'qwen3-235b-a22b',
      modelVariants: ['235b'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 1.45 },
        output: { currency: 'CNY', perMillionTokens: 5.8 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-235b-a22b-thinking-2507',
      limits: { maxOutputTokens: 114688 },
      modelId: 'qwen3-235b-a22b-thinking',
      modelVariants: ['235b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 20 } }
    },
    {
      apiModelId: 'qwen/qwen3-30b-a3b-fp8',
      limits: { contextWindow: 128000 },
      modelId: 'qwen3-30b-a3b',
      modelVariants: ['30b'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 0.72 },
        output: { currency: 'CNY', perMillionTokens: 3.26 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-32b-fp8',
      limits: { contextWindow: 128000 },
      modelId: 'qwen3-32b',
      modelVariants: ['32b'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 0.72 },
        output: { currency: 'CNY', perMillionTokens: 3.26 }
      }
    },
    { apiModelId: 'qwen/qwen3.5-122b-a10b', modelId: 'qwen3-5-122b-a10b', modelVariants: ['122b'] },
    { apiModelId: 'qwen/qwen3.5-27b', modelId: 'qwen3-5-27b', modelVariants: ['27b'] },
    { apiModelId: 'qwen/qwen3.5-35b-a3b', modelId: 'qwen3-5-35b-a3b', modelVariants: ['35b'] },
    {
      apiModelId: 'qwen/qwen3.5-397b-a17b',
      modelId: 'qwen3-5-397b-a17b',
      modelVariants: ['397b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 3 }, output: { currency: 'CNY', perMillionTokens: 18 } }
    },
    {
      apiModelId: 'qwen/qwen3.5-plus',
      modelId: 'qwen3-5-plus',
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 24 } }
    },
    {
      apiModelId: 'qwen/qwen3-coder-30b-a3b-instruct',
      modelId: 'qwen3-coder-30b-a3b-instruct',
      modelVariants: ['30b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 2.25 }, output: { currency: 'CNY', perMillionTokens: 9 } }
    },
    {
      apiModelId: 'qwen/qwen3-coder-480b-a35b-instruct',
      modelId: 'qwen3-coder-480b-a35b-instruct',
      modelVariants: ['480b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 4 }, output: { currency: 'CNY', perMillionTokens: 16 } }
    },
    {
      apiModelId: 'qwen/qwen3-coder-next',
      modelId: 'qwen3-coder-next',
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 1.4 },
        output: { currency: 'CNY', perMillionTokens: 10.5 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-embedding-0.6b',
      endpointTypes: ['openai-embeddings'],
      limits: { contextWindow: 32768, maxOutputTokens: 32768 },
      modelId: 'qwen3-embedding-0-6b',
      modelVariants: ['6b'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 0.07 },
        output: { currency: 'CNY', perMillionTokens: 0.07 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-next-80b-a3b-thinking',
      limits: { contextWindow: 65536, maxOutputTokens: 65536 },
      modelId: 'qwen3-next-80b-a3b',
      modelVariants: ['80b-thinking'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 1 }, output: { currency: 'CNY', perMillionTokens: 10 } }
    },
    {
      apiModelId: 'qwen/qwen3-next-80b-a3b-instruct',
      limits: { contextWindow: 65536, maxOutputTokens: 65536 },
      modelId: 'qwen3-next-80b-a3b-instruct',
      modelVariants: ['80b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 1 }, output: { currency: 'CNY', perMillionTokens: 4 } }
    },
    {
      apiModelId: 'qwen/qwen3-vl-235b-a22b-thinking',
      modelId: 'qwen3-vl-235b-a22b',
      modelVariants: ['235b-thinking'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 20 } }
    },
    {
      apiModelId: 'qwen/qwen3-vl-235b-a22b-instruct',
      modelId: 'qwen3-vl-235b-a22b-instruct',
      modelVariants: ['235b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 2 }, output: { currency: 'CNY', perMillionTokens: 8 } }
    },
    {
      apiModelId: 'qwen/qwen3-vl-30b-a3b-thinking',
      modelId: 'qwen3-vl-30b-a3b',
      modelVariants: ['30b-thinking'],
      pricing: {
        input: { currency: 'CNY', perMillionTokens: 0.75 },
        output: { currency: 'CNY', perMillionTokens: 7.5 }
      }
    },
    {
      apiModelId: 'qwen/qwen3-vl-30b-a3b-instruct',
      limits: { contextWindow: 131072, maxOutputTokens: 32768 },
      modelId: 'qwen3-vl-30b-a3b-instruct',
      modelVariants: ['30b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.75 }, output: { currency: 'CNY', perMillionTokens: 3 } }
    },
    {
      apiModelId: 'qwen/qwen3-vl-8b-instruct',
      limits: { maxOutputTokens: 32768 },
      modelId: 'qwen3-vl-8b-instruct',
      modelVariants: ['8b'],
      pricing: { input: { currency: 'CNY', perMillionTokens: 0.5 }, output: { currency: 'CNY', perMillionTokens: 2 } }
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['1K', '2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-4.0', isSync: true }
          },
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['1K', '2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-4.0', isSync: true }
          }
        }
      },
      modelId: 'seedream-4-0'
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-4.5', isSync: true }
          },
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-4.5', isSync: true }
          }
        }
      },
      modelId: 'seedream-4-5'
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['2K', '3K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-5.0-lite', isSync: true }
          },
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                default: '2048x2048',
                options: ['2K', '3K', '2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/seedream-5.0-lite', isSync: true }
          }
        }
      },
      modelId: 'seedream-5-0-lite'
    },
    {
      modelId: 'jimeng-txt2img-v3-1',
      apiModelId: 'jimeng-txt2img-v3.1',
      name: 'Jimeng Text-to-Image v3.1',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              promptEnhancement: { type: 'switch' },
              seed: { type: 'text' },
              size: {
                default: '1328x1328',
                options: ['1328x1328', '1472x1104', '1584x1056', '1664x936', '2016x864', '2048x2048'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/jimeng-txt2img-v3.1' }
          }
        }
      }
    },
    {
      modelId: 'jimeng-txt2img-v3-0',
      apiModelId: 'jimeng-txt2img-v3.0',
      name: 'Jimeng Text-to-Image v3.0',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              promptEnhancement: { type: 'switch' },
              seed: { type: 'text' },
              size: {
                default: '1328x1328',
                options: ['1328x1328', '1472x1104', '1584x1056', '1664x936', '2016x864', '2048x2048'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/jimeng-txt2img-v3.0' }
          }
        }
      }
    },
    {
      modelId: 'hunyuan-image-3',
      apiModelId: 'hunyuan-image-3',
      name: 'Hunyuan Image 3',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              seed: { type: 'text' },
              size: {
                options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/hunyuan-image-3' }
          }
        }
      }
    },
    {
      modelId: 'qwen-image',
      apiModelId: 'qwen-image-txt2img',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { type: 'switch' },
              size: {
                options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/qwen-image-txt2img' }
          }
        }
      }
    },
    {
      modelId: 'z-image-turbo',
      apiModelId: 'z-image-turbo',
      name: 'Z-Image Turbo',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              seed: { type: 'text' },
              size: {
                options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/z-image-turbo' }
          }
        }
      }
    },
    {
      modelId: 'z-image-turbo-lora',
      apiModelId: 'z-image-turbo-lora',
      name: 'Z-Image Turbo LoRA',
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              seed: { type: 'text' },
              size: {
                options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v3/async/z-image-turbo-lora' }
          }
        }
      }
    }
  ]
})
