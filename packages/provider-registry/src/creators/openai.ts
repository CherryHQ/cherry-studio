import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'openai',
  name: 'OpenAI',
  fetchModels: openaiCompatible('openai', 'OPENAI_API_KEY'),
  modelsDevProviders: ['openai'],
  // `text-embedding-3` / `-ada` only — bare `text-embedding` over-claims Google's `text-embedding-00x`
  // (gecko, served by google-vertex), mis-attributing them to OpenAI.
  idPrefixes: [
    'gpt',
    'o1',
    'o3',
    'o4',
    'chatgpt',
    'codex',
    'text-embedding-3',
    'text-embedding-ada',
    'text-moderation',
    'davinci',
    'babbage'
  ],
  webSearch: ['gpt-4o', 'gpt-5', 'o3', 'o4'],
  models: [
    {
      id: 'gpt-image-1-mini',
      name: 'GPT-Image-1-Mini',
      family: 'gpt-image',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              background: {
                options: ['auto', 'transparent', 'opaque'],
                type: 'enum'
              },
              moderation: {
                options: ['auto', 'low'],
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['auto', 'low', 'medium', 'high'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              background: {
                options: ['auto', 'transparent', 'opaque'],
                type: 'enum'
              },
              moderation: {
                options: ['auto', 'low'],
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['auto', 'low', 'medium', 'high'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'dall-e-3',
      name: 'DALL-E-3',
      family: 'dall-e',
      capabilities: ['function-call', 'image-generation', 'file-input'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              quality: {
                options: ['standard', 'hd'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['1024x1024', '1792x1024', '1024x1792'],
                render: 'chips',
                type: 'enum'
              },
              style: {
                options: ['vivid', 'natural'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'dall-e-2',
      name: 'Dall E 2',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              size: {
                default: '1024x1024',
                options: ['256x256', '512x512', '1024x1024'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gpt-image-2',
      name: 'GPT-Image-2',
      family: 'gpt-image',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              background: {
                options: ['auto', 'opaque'],
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['auto', 'low', 'medium', 'high'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'gpt-image-1',
      name: 'GPT-Image-1',
      family: 'gpt-image',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              background: {
                options: ['auto', 'transparent', 'opaque'],
                type: 'enum'
              },
              moderation: {
                options: ['auto', 'low'],
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['auto', 'low', 'medium', 'high'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
                render: 'chips',
                type: 'enum'
              }
            }
          },
          generate: {
            supports: {
              background: {
                options: ['auto', 'transparent', 'opaque'],
                type: 'enum'
              },
              moderation: {
                options: ['auto', 'low'],
                type: 'enum'
              },
              numImages: {
                default: 1,
                max: 10,
                min: 1,
                type: 'range'
              },
              quality: {
                options: ['auto', 'low', 'medium', 'high'],
                type: 'enum'
              },
              size: {
                default: '1024x1024',
                options: ['auto', '1024x1024', '1536x1024', '1024x1536'],
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
