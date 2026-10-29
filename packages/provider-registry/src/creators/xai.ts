import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'xai',
  name: 'xAI',
  fetchModels: openaiCompatible('grok', 'XAI_API_KEY'),
  modelsDevProviders: ['xai'],
  reasoningFamilies: [
    { pattern: '^grok-4\\.3(?!.*non-reasoning)', effort: ['none', 'low', 'medium', 'high'] },
    { pattern: '^grok-4[.-][67](?!.*non-reasoning)', effort: ['low', 'medium', 'high', 'xhigh'] },
    // grok-4-fast's on/off knob exists ONLY on OpenRouter's rebroadcast (the
    // request path special-cases it by SKU); no rule here — a synthesized
    // vocabulary would leak an unsupported reasoningEffort onto the native
    // xAI adapter.
    { pattern: '^grok-3-mini', effort: ['low', 'high'] },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '\\bgrok-(?:3-mini|4|4-fast)(?:-[\\w-]+)?\\b' },
    { pattern: 'grok-build' }
  ],
  idPrefixes: ['grok'],
  models: [
    {
      id: 'grok-4-7',
      name: 'Grok 4.7',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'structured-output'],
      inputModalities: ['text', 'image'],
      contextWindow: 500000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        output: { currency: 'USD', perMillionTokens: 6 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 }
      },
      reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] }
    },
    {
      id: 'grok-4-6',
      name: 'Grok 4.6',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'structured-output'],
      inputModalities: ['text', 'image'],
      contextWindow: 500000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        output: { currency: 'USD', perMillionTokens: 6 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 }
      },
      reasoning: { controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] }
    },
    {
      id: 'grok-4',
      name: 'Grok 4',
      capabilities: ['reasoning', 'function-call', 'image-recognition'],
      contextWindow: 256000
    },
    { id: 'grok-4-fast', name: 'Grok 4 Fast', capabilities: ['reasoning', 'function-call'], contextWindow: 2000000 },
    { id: 'grok-4-1', name: 'Grok 4.1', capabilities: ['reasoning', 'function-call'], contextWindow: 256000 },
    { id: 'grok-code-fast-1', name: 'Grok Code Fast 1', capabilities: ['function-call'], contextWindow: 256000 },
    { id: 'grok-3', name: 'Grok 3', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'grok-3-fast', name: 'Grok 3 Fast', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'grok-3-mini', name: 'Grok 3 Mini', capabilities: ['reasoning', 'function-call'], contextWindow: 131072 },
    {
      id: 'grok-3-mini-fast',
      name: 'Grok 3 Mini Fast',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 131072
    },
    { id: 'grok-2', name: 'Grok 2', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'grok-2-vision',
      name: 'Grok 2 Vision',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 32768
    },
    { id: 'grok-beta', name: 'Grok Beta', capabilities: ['function-call'], contextWindow: 131072 },
    {
      id: 'grok-vision-beta',
      name: 'Grok Vision Beta',
      capabilities: ['image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 8192
    },
    {
      id: 'grok-imagine-image',
      name: 'Grok Imagine Image',
      family: 'grok',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
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
      id: 'grok-imagine-image-2-0',
      name: 'Grok Imagine Image 2.0',
      family: 'grok',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
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
      id: 'grok-imagine-image-quality',
      name: 'Grok Imagine Image Quality',
      family: 'grok',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
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
  ]
})
