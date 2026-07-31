import { defineCreator } from './types'

export default defineCreator({
  id: 'minimax',
  name: 'MiniMax',
  modelsDevProviders: ['minimax', 'minimax-cn'],
  idPrefixes: ['minimax', 'abab'],
  reasoningFamilies: [{ pattern: 'minimax-m\\d' }],
  models: [
    { id: 'minimax-m2-1', serverTools: ['web-search'] },
    {
      id: 'image-01',
      name: 'image-01',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
                render: 'chips',
                type: 'enum'
              },
              customSize: { maxSide: 2048, minSide: 512, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' },
              size: { options: ['custom'], type: 'enum' }
            }
          },
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
                render: 'chips',
                type: 'enum'
              },
              customSize: { maxSide: 2048, minSide: 512, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' },
              size: { options: ['custom'], type: 'enum' }
            }
          }
        }
      }
    },
    {
      id: 'image-01-live',
      name: 'image-01-live',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' }
            }
          },
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' }
            }
          }
        }
      }
    }
  ]
})
