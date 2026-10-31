import { defineProvider } from './types'

export default defineProvider({
  id: 'grok',
  name: 'Grok',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'xai',
      baseUrl: 'https://api.x.ai'
    },
    'openai-image-generation': {
      adapterFamily: 'xai'
    },
    'openai-responses': {
      adapterFamily: 'xai-responses',
      baseUrl: 'https://api.x.ai/v1',
      reasoningFormat: {
        type: 'openai-responses',
        wire: {
          off: {
            operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }]
          },
          auto: {
            operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
            effortMap: { auto: 'medium' }
          },
          effort: {
            operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }]
          }
        }
      }
    }
  },
  overrides: [
    {
      modelId: 'grok-imagine-image',
      endpointTypes: ['openai-image-generation'],
      imageGeneration: {
        modes: {
          edit: {
            maxInputImages: 3,
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '3:4',
                  '4:3',
                  '9:16',
                  '16:9',
                  '2:3',
                  '3:2',
                  '9:19.5',
                  '19.5:9',
                  '9:20',
                  '20:9',
                  '1:2',
                  '2:1',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '3:4',
                  '4:3',
                  '9:16',
                  '16:9',
                  '2:3',
                  '3:2',
                  '9:19.5',
                  '19.5:9',
                  '9:20',
                  '20:9',
                  '1:2',
                  '2:1',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      apiModelId: 'grok-imagine-image-2.0',
      modelId: 'grok-imagine-image-2-0',
      endpointTypes: ['openai-image-generation'],
      imageGeneration: {
        modes: {
          edit: {
            maxInputImages: 5,
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '16:9',
                  '9:16',
                  '4:3',
                  '3:4',
                  '3:2',
                  '2:3',
                  '2:1',
                  '1:2',
                  '19.5:9',
                  '9:19.5',
                  '20:9',
                  '9:20',
                  '21:9',
                  '5:2',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '16:9',
                  '9:16',
                  '4:3',
                  '3:4',
                  '3:2',
                  '2:3',
                  '2:1',
                  '1:2',
                  '19.5:9',
                  '9:19.5',
                  '20:9',
                  '9:20',
                  '21:9',
                  '5:2',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      modelId: 'grok-imagine-image-quality',
      endpointTypes: ['openai-image-generation'],
      imageGeneration: {
        modes: {
          edit: {
            maxInputImages: 3,
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '3:4',
                  '4:3',
                  '9:16',
                  '16:9',
                  '2:3',
                  '3:2',
                  '9:19.5',
                  '19.5:9',
                  '9:20',
                  '20:9',
                  '1:2',
                  '2:1',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              aspectRatio: {
                default: 'auto',
                options: [
                  '1:1',
                  '3:4',
                  '4:3',
                  '9:16',
                  '16:9',
                  '2:3',
                  '3:2',
                  '9:19.5',
                  '19.5:9',
                  '9:20',
                  '20:9',
                  '1:2',
                  '2:1',
                  'auto'
                ],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    }
  ],
  serverTools: [{ id: 'web-search', modelScope: 'model-dependent', modelIdPrefixes: ['grok-4'] }],
  metadata: {
    website: {
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs/models',
      official: 'https://x.ai/'
    }
  }
})
