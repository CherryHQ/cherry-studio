import { defineLab } from './types'

export default defineLab({
  id: 'ideogram',
  name: 'Ideogram',
  families: ['ideogram'],
  idPrefixes: ['ideogram'],
  models: [
    {
      id: 'ideogram-v4',
      name: 'Ideogram v4',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              renderingSpeed: { options: ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'], default: 'DEFAULT', type: 'enum' },
              size: {
                options: [
                  '2048x2048',
                  '1440x2880',
                  '2880x1440',
                  '1664x2496',
                  '2496x1664',
                  '1792x2240',
                  '2240x1792',
                  '1440x2560',
                  '2560x1440',
                  '1600x2560',
                  '2560x1600',
                  '1728x2304',
                  '2304x1728',
                  '1296x3168',
                  '3168x1296',
                  '1152x2944',
                  '2944x1152',
                  '1248x3328',
                  '3328x1248',
                  '1280x3072',
                  '3072x1280',
                  '1024x3072',
                  '3072x1024'
                ],
                default: '2048x2048',
                render: 'chips',
                type: 'enum'
              }
            }
          },
          remix: {
            supports: {
              imageWeight: { max: 100, min: 1, type: 'range' },
              renderingSpeed: { options: ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'], default: 'DEFAULT', type: 'enum' },
              size: {
                options: [
                  '2048x2048',
                  '1440x2880',
                  '2880x1440',
                  '1664x2496',
                  '2496x1664',
                  '1792x2240',
                  '2240x1792',
                  '1440x2560',
                  '2560x1440',
                  '1600x2560',
                  '2560x1600',
                  '1728x2304',
                  '2304x1728',
                  '1296x3168',
                  '3168x1296',
                  '1152x2944',
                  '2944x1152',
                  '1248x3328',
                  '3328x1248',
                  '1280x3072',
                  '3072x1280',
                  '1024x3072',
                  '3072x1024'
                ],
                default: '2048x2048',
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'ideogram-v3',
      name: 'Ideogram v3',
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
              magicPromptOption: { type: 'switch' },
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { max: 8, min: 1, type: 'range' },
              renderingSpeed: { options: ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'], default: 'DEFAULT', type: 'enum' },
              seed: { type: 'text' },
              styleType: { options: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN', 'FICTION'], type: 'enum' }
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
              imageWeight: { max: 100, min: 1, type: 'range' },
              magicPromptOption: { type: 'switch' },
              negativePrompt: { multiline: true, type: 'text' },
              numImages: { max: 8, min: 1, type: 'range' },
              renderingSpeed: { options: ['FLASH', 'TURBO', 'DEFAULT', 'QUALITY'], default: 'DEFAULT', type: 'enum' },
              seed: { type: 'text' },
              styleType: { options: ['AUTO', 'GENERAL', 'REALISTIC', 'DESIGN', 'FICTION'], type: 'enum' }
            }
          },
          upscale: {
            supports: {
              detail: { max: 100, min: 1, type: 'range' },
              magicPromptOption: { type: 'switch' },
              numImages: { max: 8, min: 1, type: 'range' },
              resemblance: { max: 100, min: 1, type: 'range' },
              seed: { type: 'text' }
            }
          }
        }
      }
    },
    {
      id: 'ideogram-v2',
      name: 'Ideogram v2',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'ideogram-v2a',
      name: 'Ideogram v2a',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'ideogram-v2a-turbo',
      name: 'Ideogram v2a Turbo',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    }
  ]
})
