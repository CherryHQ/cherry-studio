import { defineCreator } from './types'

export default defineCreator({
  id: 'minimax',
  name: 'MiniMax',
  modelsDevProviders: ['minimax', 'minimax-cn'],
  idPrefixes: ['minimax', 'abab'],
  reasoningFamilies: [{ pattern: 'minimax-m\\d' }],
  models: [
    { id: 'minimax-m2-1' },
    // Video generation models (text-to-video / image-to-video). The MiniMax video API is an async
    // submit/poll flow; request params such as
    // duration/resolution belong on the serving provider transport, so the catalog only declares the
    // capability and modality per model — the same pattern as the other video creators (kling/runway/vidu).
    {
      id: 'minimax-h3',
      name: 'MiniMax H3',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image', 'video', 'audio'],
      outputModalities: ['video', 'audio']
    },
    {
      id: 'i2v-01',
      name: 'I2V-01',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'i2v-01-director',
      name: 'I2V-01 Director',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'i2v-01-live',
      name: 'I2V-01 Live',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
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
    },
    {
      id: 'minimax-hailuo-02',
      name: 'MiniMax Hailuo 02',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'minimax-hailuo-2-3',
      name: 'MiniMax Hailuo 2.3',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'minimax-hailuo-2-3-fast',
      name: 'MiniMax Hailuo 2.3 Fast',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 't2v-01',
      name: 'T2V-01',
      capabilities: ['video-generation'],
      inputModalities: ['text'],
      outputModalities: ['video']
    },
    {
      id: 't2v-01-director',
      name: 'T2V-01 Director',
      capabilities: ['video-generation'],
      inputModalities: ['text'],
      outputModalities: ['video']
    }
  ]
})
