import { defineCreator } from './types'

export default defineCreator({
  id: 'black-forest-labs',
  name: 'Black Forest Labs (FLUX)',
  families: ['flux'],
  idPrefixes: ['flux'],
  models: [
    // FLUX.1 line (the kontext/flux-2 entries below carry curated param widgets). Request params for these
    // belong on the serving provider; -kontext/-fill are edit models (image input).
    {
      id: 'flux-pro',
      name: 'FLUX.1 Pro',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'flux-1-1-pro-ultra',
      name: 'FLUX1.1 Pro Ultra',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'flux-dev',
      name: 'FLUX.1 Dev',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'flux-schnell',
      name: 'FLUX.1 Schnell',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'flux-fill-pro',
      name: 'FLUX.1 Fill Pro',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'flux-kontext-dev',
      name: 'FLUX.1 Kontext Dev',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'flux-kontext-pro',
      name: 'FLUX.1 Kontext Pro',
      family: 'flux',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        supports: {
          aspectRatio: {
            default: '1:1',
            options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'],
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
        },
        inputs: {
          images: {
            min: 1,
            max: {
              kind: 'unknown'
            }
          },
          prompt: 'required',
          mask: 'unknown',
          mediaTypes: {
            kind: 'unknown'
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
        supports: {
          aspectRatio: {
            default: '1:1',
            options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'],
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
        },
        inputs: {
          images: {
            min: 1,
            max: {
              kind: 'unknown'
            }
          },
          prompt: 'required',
          mask: 'unknown',
          mediaTypes: {
            kind: 'unknown'
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
        supports: {
          aspectRatio: {
            default: '1:1',
            options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'],
            render: 'chips',
            type: 'enum'
          },
          safetyTolerance: {
            default: 2,
            max: 5,
            min: 0,
            type: 'range'
          },
          seed: {
            type: 'text'
          }
        },
        inputs: {
          images: {
            min: 0,
            max: {
              kind: 'unknown'
            }
          },
          prompt: 'required',
          mask: 'unknown',
          mediaTypes: {
            kind: 'unknown'
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
        supports: {
          aspectRatio: {
            default: '1:1',
            options: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'],
            render: 'chips',
            type: 'enum'
          },
          safetyTolerance: {
            default: 2,
            max: 5,
            min: 0,
            type: 'range'
          },
          seed: {
            type: 'text'
          }
        },
        inputs: {
          images: {
            min: 0,
            max: {
              kind: 'unknown'
            }
          },
          prompt: 'required',
          mask: 'unknown',
          mediaTypes: {
            kind: 'unknown'
          }
        }
      }
    }
  ]
})
