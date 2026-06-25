import { defineLab } from './types'

export default defineLab({
  id: 'black-forest-labs',
  name: 'Black Forest Labs (FLUX)',
  families: ['flux'],
  idPrefixes: ['flux'],
  models: [
    {
      id: 'flux-kontext-pro',
      name: 'FLUX.1 Kontext Pro',
      family: 'flux',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: [
                  'ASPECT_1_1',
                  'ASPECT_4_3',
                  'ASPECT_3_4',
                  'ASPECT_16_9',
                  'ASPECT_9_16',
                  'ASPECT_21_9',
                  'ASPECT_9_21'
                ],
                render: 'chips',
                type: 'enum'
              },
              safetyTolerance: {
                default: 2,
                max: 6,
                min: 0,
                type: 'range'
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
      id: 'flux-kontext-max',
      name: 'FLUX.1 Kontext Max',
      family: 'flux',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: [
                  'ASPECT_1_1',
                  'ASPECT_4_3',
                  'ASPECT_3_4',
                  'ASPECT_16_9',
                  'ASPECT_9_16',
                  'ASPECT_21_9',
                  'ASPECT_9_21'
                ],
                render: 'chips',
                type: 'enum'
              },
              safetyTolerance: {
                default: 2,
                max: 6,
                min: 0,
                type: 'range'
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
      id: 'flux-2-pro',
      name: 'Flux 2 Pro',
      family: 'flux',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: [
                  'ASPECT_1_1',
                  'ASPECT_4_3',
                  'ASPECT_3_4',
                  'ASPECT_16_9',
                  'ASPECT_9_16',
                  'ASPECT_21_9',
                  'ASPECT_9_21'
                ],
                render: 'chips',
                type: 'enum'
              },
              safetyTolerance: {
                default: 2,
                max: 6,
                min: 0,
                type: 'range'
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
      id: 'flux-2-flex',
      name: 'Flux 2 Flex',
      family: 'flux',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                default: 'ASPECT_1_1',
                options: [
                  'ASPECT_1_1',
                  'ASPECT_4_3',
                  'ASPECT_3_4',
                  'ASPECT_16_9',
                  'ASPECT_9_16',
                  'ASPECT_21_9',
                  'ASPECT_9_21'
                ],
                render: 'chips',
                type: 'enum'
              },
              safetyTolerance: {
                default: 2,
                max: 6,
                min: 0,
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
