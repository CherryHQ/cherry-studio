import { defineProvider } from './types'

export default defineProvider({
  id: 'ollama',
  name: 'Ollama',
  availableInEditions: ['global', 'cn'],
  authOptional: true,
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:11434'
    },
    'ollama-chat': {
      adapterFamily: 'ollama',
      baseUrl: 'http://localhost:11434',
      reasoningFormat: { type: 'ollama' }
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library',
      official: 'https://ollama.com/'
    }
  },
  overrides: [
    // Experimental vendor-exclusive models are standalone; Main's Ollama transport owns
    // the fixed `/api/generate` protocol rather than reading per-model endpoint declarations.
    {
      modelId: 'x/z-image-turbo',
      apiModelId: 'x/z-image-turbo',
      name: 'Z-Image Turbo',
      capabilities: { force: ['image-generation'] },
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        supports: {
          seed: {
            type: 'text'
          },
          numInferenceSteps: {
            default: 9,
            max: 20,
            min: 1,
            type: 'range'
          },
          size: {
            default: '1024x1024',
            options: ['512x512', '768x768', '1024x1024'],
            render: 'chips',
            type: 'enum'
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
      modelId: 'x/flux2-klein',
      apiModelId: 'x/flux2-klein',
      name: 'FLUX.2 Klein',
      capabilities: { force: ['image-generation'] },
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        supports: {
          seed: {
            type: 'text'
          },
          size: {
            default: '1024x1024',
            options: ['512x512', '768x768', '1024x1024'],
            render: 'chips',
            type: 'enum'
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
