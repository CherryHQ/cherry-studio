import { defineLab } from './types'

export default defineLab({
  id: 'vidu',
  name: 'Shengshu (Vidu)',
  idPrefixes: ['vidu', 'viduq'],
  models: [
    {
      id: 'v-3',
      name: 'Ideogram V_3',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                options: [
                  '1:1',
                  '1:2',
                  '1:3',
                  '2:3',
                  '3:4',
                  '4:5',
                  '9:16',
                  '10:16',
                  '2:1',
                  '3:1',
                  '3:2',
                  '4:3',
                  '5:4',
                  '16:9',
                  '16:10'
                ],
                render: 'chips',
                type: 'enum'
              },
              magicPromptOption: {
                type: 'switch'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                max: 8,
                min: 1,
                type: 'range'
              },
              renderingSpeed: {
                options: ['DEFAULT', 'TURBO', 'QUALITY'],
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              styleType: {
                options: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'],
                type: 'enum'
              }
            }
          },
          remix: {
            supports: {
              aspectRatio: {
                options: [
                  '1:1',
                  '1:2',
                  '1:3',
                  '2:3',
                  '3:4',
                  '4:5',
                  '9:16',
                  '10:16',
                  '2:1',
                  '3:1',
                  '3:2',
                  '4:3',
                  '5:4',
                  '16:9',
                  '16:10'
                ],
                render: 'chips',
                type: 'enum'
              },
              imageWeight: {
                max: 100,
                min: 1,
                type: 'range'
              },
              magicPromptOption: {
                type: 'switch'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              numImages: {
                max: 8,
                min: 1,
                type: 'range'
              },
              renderingSpeed: {
                options: ['DEFAULT', 'TURBO', 'QUALITY'],
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              styleType: {
                options: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN'],
                type: 'enum'
              }
            }
          },
          upscale: {
            supports: {
              detail: {
                max: 100,
                min: 1,
                type: 'range'
              },
              magicPromptOption: {
                type: 'switch'
              },
              numImages: {
                max: 8,
                min: 1,
                type: 'range'
              },
              resemblance: {
                max: 100,
                min: 1,
                type: 'range'
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
