import { defineCreator } from './types'

export default defineCreator({
  id: 'bytedance',
  name: 'ByteDance (Doubao)',
  families: ['doubao', 'seed'],
  idPrefixes: ['doubao', 'skylark'],
  // Doubao is proprietary with no clean public listing (only resellers on models.dev; sparse on OR),
  // and the Volcengine Ark API has no /models endpoint — so the current chat/vision line is hand-listed.
  // Metadata for the ids OpenRouter does carry is still enriched at generation time.
  models: [
    {
      id: 'doubao-seed-2-1-pro',
      name: 'Doubao Seed 2.1 Pro',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144
    },
    {
      id: 'doubao-seed-2-1-turbo',
      name: 'Doubao Seed 2.1 Turbo',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144
    },
    {
      id: 'doubao-seed-evolving',
      name: 'Doubao Seed Evolving',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 262144
    },
    // Seed 2.0 line — specs from the model list (volcengine.com/docs/82379/1330310): deep-thinking +
    // multimodal (image/video/doc) understanding + tools; 256k context, 128k max output.
    {
      id: 'doubao-seed-2-0-pro',
      name: 'Doubao Seed 2.0 Pro',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 131072
    },
    {
      id: 'doubao-seed-2-0-lite',
      name: 'Doubao Seed 2.0 Lite',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 131072
    },
    {
      id: 'doubao-seed-2-0-mini',
      name: 'Doubao Seed 2.0 Mini',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 131072
    },
    {
      id: 'doubao-seed-2-0-code',
      name: 'Doubao Seed 2.0 Code',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 131072
    },
    // Seed 1.6 line — same multimodal stack + structured output; 256k context, 32k max output. The vision
    // variant adds GUI (computer-use).
    {
      id: 'doubao-seed-1-6',
      name: 'Doubao Seed 1.6',
      capabilities: [
        'reasoning',
        'function-call',
        'image-recognition',
        'video-recognition',
        'file-input',
        'structured-output'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    {
      id: 'doubao-seed-1-6-flash',
      name: 'Doubao Seed 1.6 Flash',
      capabilities: [
        'reasoning',
        'function-call',
        'image-recognition',
        'video-recognition',
        'file-input',
        'structured-output'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    {
      id: 'doubao-seed-1-6-vision',
      name: 'Doubao Seed 1.6 Vision',
      capabilities: [
        'reasoning',
        'function-call',
        'image-recognition',
        'video-recognition',
        'file-input',
        'structured-output',
        'computer-use'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    // Doubao 1.5 Thinking line is no longer in the current model list (1330310); left bare pending a source.
    { id: 'doubao-1-5-thinking-pro' },
    { id: 'doubao-1-5-thinking-vision-pro' },
    // Doubao 1.5 line — text/tools (vision-pro adds image understanding). Smaller windows.
    {
      id: 'doubao-1-5-vision-pro',
      name: 'Doubao 1.5 Vision Pro',
      capabilities: ['image-recognition', 'function-call'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 32768,
      maxOutputTokens: 12288
    },
    {
      id: 'doubao-1-5-pro-32k',
      name: 'Doubao 1.5 Pro 32k',
      capabilities: ['function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 131072,
      maxOutputTokens: 16384
    },
    {
      id: 'doubao-1-5-lite-32k',
      name: 'Doubao 1.5 Lite 32k',
      capabilities: ['function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 32768,
      maxOutputTokens: 12288
    },
    {
      id: 'doubao-seedream-4-5',
      name: 'Doubao Seedream 4 5',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
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
      id: 'doubao-seedream-4-0',
      name: 'Doubao Seedream 4 0',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['1K', '2K', '4K'],
                render: 'chips',
                type: 'enum'
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
