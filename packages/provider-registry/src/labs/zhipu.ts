import { openaiCompatible } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'zhipu',
  name: 'Zhipu / Z.ai (GLM)',
  fetchModels: openaiCompatible('zhipu', 'ZHIPU_API_KEY'),
  modelsDevProviders: ['zhipuai', 'zai'],
  families: ['glm'],
  idPrefixes: ['glm', 'cogview', 'cogvideo', 'codegeex', 'chatglm'],
  models: [
    {
      id: 'cogview-4',
      name: 'cogview-4',
      capabilities: ['image-generation'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              customSize: {
                maxSide: 2048,
                minSide: 512,
                pairedEnumKey: 'size',
                type: 'size'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                default: 1,
                max: 1,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['standard', 'hd'],
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'glm-image',
      name: 'glm-image',
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
              size: {
                default: '1280x1280',
                options: ['1280x1280', '1568x1056', '1056x1568', '1472x1088', '1088x1472', '1728x960', '960x1728'],
                render: 'chips',
                type: 'enum'
              }
            },
            vendorTransport: {
              endpoint: '/v3/async/glm-image'
            }
          }
        }
      }
    }
  ]
})
