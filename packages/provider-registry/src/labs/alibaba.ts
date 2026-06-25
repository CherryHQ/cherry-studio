import { defineLab } from './types'

export default defineLab({
  id: 'alibaba',
  name: 'Alibaba (Qwen)',
  modelsDevProviders: ['alibaba', 'alibaba-cn'],
  families: ['qwen', 'qvq'],
  idPrefixes: ['qwen', 'qvq', 'tongyi'],
  models: [
    {
      id: 'qwen-image',
      name: 'Qwen Image',
      family: 'qwen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: {
                default: 1,
                max: 1,
                min: 1,
                type: 'range'
              },
              size: {
                default: '1664x928',
                options: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'qwen-image-edit',
      name: 'Qwen Image Edit',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              outputFormat: {
                options: ['jpeg', 'png', 'webp'],
                type: 'enum'
              },
              seed: {
                type: 'text'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-6-image',
      name: 'wan2.6-image',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              promptExtend: {
                default: true,
                type: 'switch'
              },
              seed: {
                type: 'text'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-7-image',
      name: 'wan2.7-image',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              thinkingMode: {
                default: true,
                type: 'switch'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-7-image-pro',
      name: 'wan2.7-image-pro',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              thinkingMode: {
                default: true,
                type: 'switch'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-6-t2i',
      name: 'wan2-6-t2i',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              promptExtend: {
                default: true,
                type: 'switch'
              },
              seed: {
                type: 'text'
              }
            }
          }
        }
      }
    }
  ]
})
