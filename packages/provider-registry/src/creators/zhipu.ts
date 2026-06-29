import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'zhipu',
  name: 'Zhipu / Z.ai (GLM)',
  fetchModels: openaiCompatible('zhipu', 'ZHIPU_API_KEY'),
  modelsDevProviders: ['zhipuai', 'zai'],
  families: ['glm'],
  idPrefixes: ['glm', 'cogview', 'cogvideo', 'codegeex', 'chatglm'],
  models: [
    { id: 'glm-4', name: 'GLM-4', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'glm-4-plus', name: 'GLM-4-Plus', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'glm-4-air', name: 'GLM-4-Air', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'glm-4-airx', name: 'GLM-4-AirX', capabilities: ['function-call'], contextWindow: 8192 },
    { id: 'glm-4-flash', name: 'GLM-4-Flash', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'glm-4-flashx', name: 'GLM-4-FlashX', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'glm-4-long', name: 'GLM-4-Long', capabilities: ['function-call'], contextWindow: 1024000 },
    { id: 'glm-3-turbo', name: 'GLM-3-Turbo', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'glm-4v',
      name: 'GLM-4V',
      capabilities: ['image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 8192
    },
    {
      id: 'glm-4v-plus',
      name: 'GLM-4V-Plus',
      capabilities: ['image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 8192
    },
    {
      id: 'glm-4v-flash',
      name: 'GLM-4V-Flash',
      capabilities: ['image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 8192
    },
    {
      id: 'glm-4-1v',
      name: 'GLM-4.1V-Thinking',
      capabilities: ['reasoning', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 65536
    },
    { id: 'glm-z1', name: 'GLM-Z1', capabilities: ['reasoning'], contextWindow: 131072 },
    { id: 'glm-z1-air', name: 'GLM-Z1-Air', capabilities: ['reasoning'], contextWindow: 131072 },
    { id: 'glm-z1-airx', name: 'GLM-Z1-AirX', capabilities: ['reasoning'], contextWindow: 131072 },
    { id: 'glm-z1-flash', name: 'GLM-Z1-Flash', capabilities: ['reasoning'], contextWindow: 131072 },
    { id: 'embedding-3', name: 'Embedding-3', outputModalities: ['vector'], contextWindow: 8192 },
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
            }
          }
        }
      }
    }
  ]
})
