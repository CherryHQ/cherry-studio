import { defineProvider } from './types'

export default defineProvider({
  id: 'ollama',
  name: 'Ollama',
  authOptional: true,
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:11434'
    },
    'ollama-chat': {
      adapterFamily: 'ollama',
      baseUrl: 'http://localhost:11434'
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
    // Ollama's own experimental image-gen models (served through `/api/generate`,
    // not a separate creator catalog) — vendor-exclusive, so declared standalone
    // here rather than in `src/creators/`. No `vendorTransport`: the AI SDK
    // adapter (`src/main/ai/provider/custom/ollama/`) always calls the local
    // `/api/generate` endpoint directly, it doesn't read registry-declared routing.
    {
      modelId: 'x/z-image-turbo',
      apiModelId: 'x/z-image-turbo',
      name: 'Z-Image Turbo',
      capabilities: { force: ['image-generation'] },
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              seed: { type: 'text' },
              numInferenceSteps: { default: 9, max: 20, min: 1, type: 'range' },
              size: {
                default: '1024x1024',
                options: ['512x512', '768x768', '1024x1024'],
                render: 'chips',
                type: 'enum'
              }
            }
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
        modes: {
          generate: {
            supports: {
              seed: { type: 'text' },
              size: {
                default: '1024x1024',
                options: ['512x512', '768x768', '1024x1024'],
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
