import { defineLab } from './types'

export default defineLab({
  id: 'kling',
  name: 'Kuaishou (Kling)',
  idPrefixes: ['kling'],
  models: [
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
