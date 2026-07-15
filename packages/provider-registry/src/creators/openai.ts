import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'openai',
  name: 'OpenAI',
  fetchModels: openaiCompatible('openai', 'OPENAI_API_KEY'),
  modelsDevProviders: ['openai'],
  reasoningFamilies: [
    { pattern: '^(?:o\\d|gpt).*deep[-_]?research', effort: ['medium'] },
    { pattern: '^gpt-5[.-]1-codex-max', effort: ['medium', 'high', 'xhigh'] },
    { pattern: '^gpt-5[.-]1-codex', effort: ['medium', 'high'] },
    { pattern: '^gpt-5[.-]1(?!\\d)', effort: ['none', 'low', 'medium', 'high'] },
    { pattern: '^gpt-5-pro', effort: ['high'] },
    { pattern: '^gpt-5[.-]\\d+-pro', effort: ['medium', 'high', 'xhigh'] },
    { pattern: '^gpt-5-codex', effort: ['low', 'medium', 'high'] },
    { pattern: '^gpt-5[.-]\\d+-codex', effort: ['low', 'medium', 'high', 'xhigh'] },
    // gpt-5.2 and later minor versions inherit the 5.2 vocabulary
    { pattern: '^gpt-5[.-]\\d+(?!.*chat)', effort: ['none', 'low', 'medium', 'high', 'xhigh'] },
    { pattern: '^gpt-5(?![.-]\\d)(?!.*chat)', effort: ['minimal', 'low', 'medium', 'high'] },
    { pattern: '^gpt-oss', effort: ['low', 'medium', 'high'] },
    // o-series reasoning SKUs (excluding the non-reasoning previews)
    { pattern: '^o1(?!-preview|-mini)|^o3|^o4', effort: ['low', 'medium', 'high'] }
  ],
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
    },
    // GPT-5 chat / reasoning SKUs. models.dev over-tags these with `image-generation`
    // + an `image` output modality — GPT-5 emits images only via the Responses
    // `image_generation` TOOL, never the `/images` endpoint. That stray capability floats
    // them into the painting model picker (see paintingModelOptions.supportsImageGenerationEndpoint),
    // where they can be selected but every generation fails. Restate them as the text-out
    // chat models they are; drop the image-gen capability + modality.
    {
      id: 'gpt-5-chat',
      name: 'GPT-5 Chat',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      outputModalities: ['text']
    },
    {
      id: 'gpt-5-1',
      name: 'GPT 5.1 Thinking',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'structured-output', 'file-input'],
      outputModalities: ['text']
    }
  ]
})
