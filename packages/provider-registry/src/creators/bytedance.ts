import { defineCreator } from './types'

export default defineCreator({
  id: 'bytedance',
  name: 'ByteDance (Doubao)',
  families: ['doubao', 'seed'],
  idPrefixes: ['doubao', 'seedream', 'skylark'],
  reasoningFamilies: [
    {
      pattern: 'doubao-seed-1-6-(?:lite-)?251015|doubao-seed-2[.-]\\d|doubao-seed-1[.-]8',
      effort: ['minimal', 'low', 'medium', 'high']
    },
    // Auto-capable SKUs.
    {
      pattern: 'doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\\d+)?$',
      effort: ['none', 'auto', 'high']
    },
    // Remaining thinking SKUs: on/off only. This pattern doubles as the
    // budget tier for the whole family (it also matches the SKUs above).
    {
      pattern:
        'doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\\d+)?|seed-2[.-]\\d(?:-[\\w-]+)?)(?:-[\\w-]+)*',
      effort: ['none', 'high'],
      budget: { min: 0, max: 30720 }
    },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    {
      pattern:
        'doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\\d+)?|seed-2[.-]\\d(?:-[\\w-]+)?)(?:-[\\w-]+)*'
    },
    { pattern: 'seed-oss' },
    { pattern: '^seed-[12][.-]\\d' }
  ],
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
      contextWindow: 1024000,
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
    // Doubao 1.5 Thinking line — deep-thinking + tools; the vision-pro variant adds image understanding.
    {
      id: 'doubao-1-5-thinking-pro',
      name: 'Doubao 1.5 Thinking Pro',
      capabilities: ['reasoning', 'function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 131072,
      maxOutputTokens: 16384
    },
    {
      id: 'doubao-1-5-thinking-pro-m',
      name: 'Doubao 1.5 Thinking Pro M',
      capabilities: ['reasoning', 'function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 131072,
      maxOutputTokens: 16384
    },
    {
      id: 'doubao-1-5-thinking-vision-pro',
      name: 'Doubao 1.5 Thinking Vision Pro',
      capabilities: ['reasoning', 'function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 131072,
      maxOutputTokens: 16384
    },
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
    // Doubao 1.5 Vision Pro 32k / Vision Lite — image understanding + tools.
    {
      id: 'doubao-1-5-vision-pro-32k',
      name: 'Doubao 1.5 Vision Pro 32k',
      capabilities: ['image-recognition', 'function-call'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 32768,
      maxOutputTokens: 12288
    },
    {
      id: 'doubao-1-5-vision-lite',
      name: 'Doubao 1.5 Vision Lite',
      capabilities: ['image-recognition', 'function-call'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text']
    },
    // Doubao 1.5 Pro 256k — long-context text + tools.
    {
      id: 'doubao-1-5-pro-256k',
      name: 'Doubao 1.5 Pro 256k',
      capabilities: ['function-call'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 262144
    },
    // UI-TARS — GUI agent (computer use) with visual grounding.
    {
      id: 'doubao-1-5-ui-tars',
      name: 'Doubao 1.5 UI-TARS',
      capabilities: ['computer-use', 'image-recognition', 'function-call'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text']
    },
    // Seed 1.6 Lite — same multimodal reasoning stack as Seed 1.6, lighter tier. 256k / 32k.
    {
      id: 'doubao-seed-1-6-lite',
      name: 'Doubao Seed 1.6 Lite',
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
    // Seed Code (preview) — coding-focused, deep-thinking + multimodal + tools. 256k / 32k.
    {
      id: 'doubao-seed-code-preview',
      name: 'Doubao Seed Code',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    // Seed Character — role-play tuned, deep-thinking + multimodal + tools + structured output. 128k / 32k.
    {
      id: 'doubao-seed-character',
      name: 'Doubao Seed Character',
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
      contextWindow: 131072,
      maxOutputTokens: 32768
    },
    // Seed Translation — dedicated translation model; no tools/vision. 4k / 3k.
    {
      id: 'doubao-seed-translation',
      name: 'Doubao Seed Translation',
      capabilities: [],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 4096,
      maxOutputTokens: 3072
    },
    // Embedding line — vector output (embedding-vision also takes image/video).
    {
      id: 'doubao-embedding-vision',
      name: 'Doubao Embedding Vision',
      capabilities: ['embedding'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['vector'],
      contextWindow: 131072
    },
    {
      id: 'doubao-embedding-large-text',
      name: 'Doubao Embedding Large Text',
      capabilities: ['embedding'],
      inputModalities: ['text'],
      outputModalities: ['vector']
    },
    {
      id: 'doubao-embedding-text',
      name: 'Doubao Embedding Text',
      capabilities: ['embedding'],
      inputModalities: ['text'],
      outputModalities: ['vector']
    },
    // Seedream image line — params per the image-gen API (docs/82379/1541523): size tiers differ per
    // model, `seed` is no longer an API param, and 5.0 adds output_format. Group-image generation
    // (sequential_image_generation + max_images) is 5.0-lite/4.5/4.0 only — 5.0 pro is single-image.
    {
      id: 'doubao-seedream-5-0-pro',
      name: 'Doubao Seedream 5.0 Pro',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 10,
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              outputFormat: {
                default: 'jpeg',
                options: ['jpeg', 'png'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'doubao-seedream-5-0-lite',
      name: 'Doubao Seedream 5.0 Lite',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 14,
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['2K', '3K', '4K'],
                render: 'chips',
                type: 'enum'
              },
              maxImages: {
                default: 15,
                max: 15,
                min: 1,
                type: 'range'
              },
              outputFormat: {
                default: 'jpeg',
                options: ['jpeg', 'png'],
                type: 'enum'
              },
              sequentialImageGeneration: {
                default: 'disabled',
                options: ['disabled', 'auto'],
                type: 'enum'
              }
            }
          }
        }
      }
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
            maxInputImages: 14,
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '2K',
                options: ['2K', '4K'],
                render: 'chips',
                type: 'enum'
              },
              maxImages: {
                default: 15,
                max: 15,
                min: 1,
                type: 'range'
              },
              sequentialImageGeneration: {
                default: 'disabled',
                options: ['disabled', 'auto'],
                type: 'enum'
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
            maxInputImages: 14,
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
              maxImages: {
                default: 15,
                max: 15,
                min: 1,
                type: 'range'
              },
              sequentialImageGeneration: {
                default: 'disabled',
                options: ['disabled', 'auto'],
                type: 'enum'
              }
            }
          }
        }
      }
    },
    // Seedream 3.0 (text-to-image) and SeedEdit 3.0 (image editing) — older image line; params fall
    // back to the provider painting form (no bespoke imageGeneration block).
    {
      id: 'doubao-seedream-3-0-t2i',
      name: 'Doubao Seedream 3.0 T2I',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'doubao-seededit-3-0-i2i',
      name: 'Doubao SeedEdit 3.0 I2I',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'doubao-seedance-2-0',
      name: 'Doubao Seedance 2.0',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image', 'video', 'audio'],
      outputModalities: ['video']
    },
    {
      id: 'doubao-seedance-2-0-fast',
      name: 'Doubao Seedance 2.0 Fast',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image', 'video', 'audio'],
      outputModalities: ['video']
    },
    {
      id: 'doubao-seedance-2-0-mini',
      name: 'Doubao Seedance 2.0 Mini',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['video']
    },
    // Seedance 1.0 — text/image-to-video generation.
    {
      id: 'doubao-seedance-1-0-pro',
      name: 'Doubao Seedance 1.0 Pro',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'doubao-seedance-1-0-pro-fast',
      name: 'Doubao Seedance 1.0 Pro Fast',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'doubao-seedance-1-0-lite-i2v',
      name: 'Doubao Seedance 1.0 Lite I2V',
      capabilities: ['image-recognition', 'video-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'doubao-seedance-1-0-lite-t2v',
      name: 'Doubao Seedance 1.0 Lite T2V',
      capabilities: ['video-generation'],
      inputModalities: ['text'],
      outputModalities: ['video']
    }
  ]
})
