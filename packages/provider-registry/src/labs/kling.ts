import { defineLab } from './types'

export default defineLab({
  id: 'kling',
  name: 'Kuaishou (Kling)',
  idPrefixes: ['kling'],
  models: [
    // Kling video models (kolors below is the image model). Request params (duration/mode/cfg) belong on
    // the serving provider; per-op endpoints (lip-sync, extend, multi-elements…) are provider transport.
    {
      id: 'kling-v2-6',
      name: 'Kling v2.6',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v2-5-turbo',
      name: 'Kling v2.5 Turbo',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v2-master',
      name: 'Kling v2 Master',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v2-1',
      name: 'Kling v2.1',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v2-1-master',
      name: 'Kling v2.1 Master',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v1-6',
      name: 'Kling v1.6',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v1-5',
      name: 'Kling v1.5',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kling-v1',
      name: 'Kling v1',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'kolors',
      name: 'Kolors',
      family: 'Kolors',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              guidanceScale: {
                default: 4.5,
                max: 20,
                min: 1,
                type: 'range'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                default: 1,
                max: 4,
                min: 1,
                type: 'range'
              },
              numInferenceSteps: {
                default: 25,
                max: 50,
                min: 1,
                type: 'range'
              },
              promptEnhancement: {
                type: 'switch'
              },
              seed: {
                type: 'text'
              },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '1280x960', '960x1280', '768x1024', '1024x768'],
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
