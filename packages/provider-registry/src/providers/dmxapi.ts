import { openaiCompatible } from './types'

export default openaiCompatible({
  id: 'dmxapi',
  name: 'DMXAPI',
  baseUrl: 'https://www.dmxapi.cn',
  anthropic: 'https://www.dmxapi.cn',
  website: {
    apiKey: 'https://www.dmxapi.cn/',
    docs: 'https://doc.dmxapi.cn/',
    models: 'https://www.dmxapi.cn/pricing',
    official: 'https://www.dmxapi.cn/'
  },
  overrides: [
    {
      apiModelId: 'dall-e-3',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              quality: { options: ['standard', 'hd'], type: 'enum' },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '1792x1024', '1024x1792'],
                render: 'chips',
                type: 'enum'
              },
              style: { options: ['vivid', 'natural'], type: 'enum' }
            }
          }
        }
      },
      modelId: 'dall-e-3'
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          merge: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      modelId: 'doubao-seedream-4-0'
    },
    {
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          merge: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '2048x2048',
                options: [
                  '2048x2048',
                  '2304x1728',
                  '1728x2304',
                  '2560x1440',
                  '1440x2560',
                  '2496x1664',
                  '1664x2496',
                  '3024x1296'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      modelId: 'doubao-seedream-4-5'
    },
    {
      apiModelId: 'doubao-seedream-5.0-lite',
      capabilities: { force: ['image-generation'] },
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: { default: true, type: 'switch' },
              maxImages: { default: 1, max: 15, min: 1, type: 'range' },
              outputFormat: { options: ['png', 'jpeg'], type: 'enum' },
              seed: { type: 'text' },
              sequentialImageGeneration: { default: 'disabled', options: ['auto', 'disabled'], type: 'enum' },
              size: { default: '2K', options: ['2K', '3K', '2048x2048'], render: 'chips', type: 'enum' }
            },
            vendorTransport: { endpoint: '/v1/responses', isSync: true }
          }
        }
      },
      inputModalities: ['text'],
      modelId: 'doubao-seedream-5-0-lite',
      name: 'Doubao Seedream 5.0 Lite',
      outputModalities: ['image'],
      ownedBy: 'bytedance'
    },
    {
      apiModelId: 'gemini-3.1-flash-image-preview',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '9:16', '16:9', '3:4', '4:3', '2:3', '3:2'],
                render: 'chips',
                type: 'enum'
              },
              imageResolution: { default: '1K', options: ['1K', '2K', '4K'], render: 'chips', type: 'enum' }
            },
            vendorTransport: { endpoint: '/v1beta/models', isSync: true }
          }
        }
      },
      modelId: 'gemini-3-1-flash-image-preview'
    },
    {
      apiModelId: 'gpt-image-1.5',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              background: { options: ['auto', 'transparent', 'opaque'], type: 'enum' },
              moderation: { options: ['auto', 'low'], type: 'enum' },
              numImages: { default: 1, max: 10, min: 1, type: 'range' },
              outputFormat: { options: ['png', 'jpeg', 'webp'], type: 'enum' },
              quality: { options: ['auto', 'low', 'medium', 'high'], type: 'enum' },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      modelId: 'gpt-image-1-5'
    },
    {
      apiModelId: 'qwen-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: { default: 1, max: 4, min: 1, type: 'range' },
              size: {
                default: '1328x1328',
                options: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v1/images/generations', isSync: true }
          }
        }
      },
      modelId: 'qwen-image'
    },
    {
      apiModelId: 'wan2.6-t2i',
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
                default: '1280x1280',
                options: ['1280x1280', '1664x928', '928x1664', '1472x1140', '1140x1472'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: { endpoint: '/v1/responses', isSync: true }
          }
        }
      },
      modelId: 'wan2-6-t2i'
    },
    {
      modelId: 'gemini-2-5-flash-image',
      apiModelId: 'gemini-2.5-flash-image',
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: { default: '1x1', options: ['1x1'], render: 'chips', type: 'enum' }
            }
          },
          generate: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: { default: '1x1', options: ['1x1'], render: 'chips', type: 'enum' }
            }
          },
          merge: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: { default: '1x1', options: ['1x1'], render: 'chips', type: 'enum' }
            }
          }
        }
      }
    },
    {
      modelId: 'musesteamer-air-image',
      apiModelId: 'musesteamer-air-image',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: { default: 1, max: 1, min: 1, type: 'range' },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '1152x864', '864x1152', '1664x928', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      },
      name: 'MuseSteamer Air Image',
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      modelId: 'nano-banana',
      apiModelId: 'nano-banana',
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '16:9', '9:16', '4:3', '3:4', '1x1'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 1, min: 1, type: 'range' }
            }
          },
          generate: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '16:9', '9:16', '4:3', '3:4', '1x1'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 1, min: 1, type: 'range' }
            }
          },
          merge: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '16:9', '9:16', '4:3', '3:4', '1x1'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 1, min: 1, type: 'range' }
            }
          }
        }
      },
      name: 'Nano Banana',
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      modelId: 'nano-banana-2',
      apiModelId: 'nano-banana-2',
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 1, min: 1, type: 'range' }
            }
          },
          merge: {
            supports: {
              aspectRatio: {
                default: '1:1',
                options: ['1:1', '16:9', '9:16', '4:3', '3:4'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 1, min: 1, type: 'range' }
            }
          }
        }
      },
      name: 'Nano Banana 2',
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    }
  ]
})
