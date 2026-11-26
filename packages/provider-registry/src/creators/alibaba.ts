import type { ImageModeDef } from '../schemas/model'
import { defineCreator } from './types'

/** qwen-image-3.0 / -pro serve text-to-image and editing off one model id, so both modes share a set. */
const qwenImage3Supports: ImageModeDef['supports'] = {
  negativePrompt: { multiline: true, type: 'text' },
  numImages: { default: 1, max: 6, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: {
    default: 'auto',
    options: ['auto', '1328x1328', '1664x928', '928x1664', '1472x1140', '1140x1472'],
    render: 'chips',
    type: 'enum'
  }
}

// Frozen docs record only T2I, 1 output, and 1664x928 max (no fixed size enum);
// SizeSpecSchema requires symmetric bounds + paired enum, so size stays free-form text.
const qwenImage1T2iSupports: ImageModeDef['supports'] = {
  negativePrompt: { multiline: true, type: 'text' },
  numImages: { default: 1, max: 1, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: { type: 'text' }
}

/** qwen-image-2.0 / -pro support t2i + edit (up to 3 ref images) with up to 6 outputs and 512*512..2048*2048 area. */
const qwenImage20SizeOptions = ['2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368']

const qwenImage20GenerateSupports: ImageModeDef['supports'] = {
  negativePrompt: { multiline: true, type: 'text' },
  numImages: { default: 1, max: 6, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: { default: '2048x2048', options: qwenImage20SizeOptions, render: 'chips', type: 'enum' }
}

const qwenImage20EditSupports: ImageModeDef['supports'] = {
  ...qwenImage20GenerateSupports,
  size: { options: qwenImage20SizeOptions, render: 'chips', type: 'enum' }
}

/** qwen-image-2.1-pro / -turbo support t2i + edit (up to 10 ref images); negative_prompt is 3.0-only. */
const qwenImage21Supports: ImageModeDef['supports'] = {
  numImages: { default: 1, max: 6, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: {
    default: 'auto',
    options: ['auto', '1024x1024', '2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368'],
    render: 'chips',
    type: 'enum'
  }
}

/** qwen-image-edit-max / -plus are edit-only with up to 6 outputs and 2048x2048 max pixel area. */
const qwenImageEditMultiSupports: ImageModeDef['supports'] = {
  negativePrompt: { multiline: true, type: 'text' },
  numImages: { default: 1, max: 6, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: {
    options: ['1024x1024', '2048x2048', '2688x1536', '1536x2688', '2368x1728', '1728x2368'],
    render: 'chips',
    type: 'enum'
  }
}

// Frozen CN docs record only T2I, 1 output, and 2048x2048 max (no size enum or default);
// keep size free-form text rather than inventing unverified presets.
const zImageTurboSupports: ImageModeDef['supports'] = {
  numImages: { default: 1, max: 1, min: 1, type: 'range' },
  seed: { type: 'text' },
  size: { type: 'text' }
}

export default defineCreator({
  id: 'alibaba',
  name: 'Alibaba (Qwen)',
  modelsDevProviders: ['alibaba', 'alibaba-cn'],
  families: ['qwen', 'qvq'],
  idPrefixes: ['qwen', 'qvq', 'tongyi'],
  reasoningFamilies: [
    // Upstream sometimes reports reasoning controls for non-thinking coder /
    // instruct SKUs. This template grants no membership and blocks the broad
    // Qwen toggle rule below, so generation can discard the mislabeled block.
    { pattern: '^qwen3-(?=.*(?:coder|instruct))', toggle: false, template: true },
    // Always-think SKUs: thinking cannot be disabled — the explicit
    // `toggle: false` stops the generic qwen rule below; budget still applies.
    { pattern: '^qwen3(?:-vl)?-.*thinking', toggle: false },
    // `qwen3.8-max-preview` serves thinking mode only, unlike the hybrid
    // `qwen3.8-max` (help.aliyun.com/zh/model-studio/text-generation-model).
    { pattern: '^qwen3[.-]8-max-preview', toggle: false },
    {
      pattern: '^qwen3[.-]8-flash$',
      effort: ['low', 'medium', 'xhigh'],
      budget: { min: 0, max: 262144 },
      toggle: true
    },
    { pattern: '^qwen3[.-]8-flash-next$', effort: ['low', 'medium', 'xhigh'] },
    // QwQ/QVQ always-reasoning previews.
    { pattern: '^qwq|^qvq', toggle: false },
    { pattern: '^qwen', toggle: true, template: true },
    { pattern: 'qwen3-235b-a22b-thinking-2507$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-30b-a3b-thinking-2507$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-vl-235b-a22b-thinking$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-vl-30b-a3b-thinking$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen-plus-2025-07-14$', budget: { min: 0, max: 38912 }, template: true },
    { pattern: 'qwen-plus-2025-04-28$', budget: { min: 0, max: 38912 }, template: true },
    { pattern: 'qwen3-1[.-]7b$', budget: { min: 0, max: 30720 }, template: true },
    { pattern: 'qwen3-0[.-]6b$', budget: { min: 0, max: 30720 }, template: true },
    { pattern: 'qwen-plus.*$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen-turbo.*$', budget: { min: 0, max: 38912 }, template: true },
    { pattern: 'qwen-flash.*$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-max(-.*)?$', budget: { min: 0, max: 81920 }, template: true },
    // `qwen-max-latest` is a distinct alias — the versioned SKU predates
    // thinking-token support.
    { pattern: 'qwen-max-latest$', budget: { min: 0, max: 81920 }, template: true },
    { pattern: '^qwen3[.-][5-7](?!\\d)', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-(?!max)(?!\\d+[.-]max).*$', budget: { min: 1024, max: 38912 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^qwen3.*thinking' },
    { pattern: 'qwq|qvq' },
    { pattern: '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen-?3[.-][5-9](?!\\d)' },
    {
      pattern:
        '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)'
    },
    {
      pattern:
        '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen(?:3[.-][5-9])?-(?:plus|flash|turbo)(?:-|$)'
    },
    { pattern: '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen-?3-\\d' },
    // Hybrid-thinking multimodal / next lines (coder & instruct SKUs stay out — they don't think).
    { pattern: '^(?!.*(?:coder|instruct))qwen-?3-(?:vl|omni|next)' }
  ],
  models: [
    {
      id: 'qwen3-5-4b',
      name: 'Qwen3.5 4B',
      family: 'qwen',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'video-recognition', 'structured-output'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 262144
    },
    {
      id: 'qwen3-8-flash',
      name: 'Qwen3.8 Flash',
      family: 'qwen',
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'structured-output'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxInputTokens: 991808,
      maxOutputTokens: 131072
    },
    {
      id: 'qwen3-8-flash-next',
      name: 'Qwen 3.8 Flash Next',
      family: 'qwen',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text']
    },
    {
      id: 'qwen3-8-max',
      name: 'Qwen3.8 Max',
      family: 'qwen',
      capabilities: ['reasoning', 'function-call'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxInputTokens: 991000,
      maxOutputTokens: 128000
    },
    {
      id: 'qwen3-8-max-preview',
      name: 'Qwen3.8 Max Preview',
      family: 'qwen',
      capabilities: ['reasoning', 'function-call'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxInputTokens: 991000,
      maxOutputTokens: 128000
    },
    {
      id: 'qwen-image',
      name: 'Qwen Image',
      family: 'qwen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              numImages: {
                default: 1,
                max: 1,
                min: 1,
                type: 'range'
              },
              size: {
                default: '1664x928',
                options: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
                render: 'chips',
                type: 'enum'
              }
            }
          }
        }
      }
    },
    {
      id: 'qwen-image-3-0',
      name: 'Qwen Image 3.0',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { supports: qwenImage3Supports },
          generate: { supports: qwenImage3Supports }
        }
      }
    },
    {
      id: 'qwen-image-3-0-pro',
      name: 'Qwen Image 3.0 Pro',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { supports: qwenImage3Supports },
          generate: { supports: qwenImage3Supports }
        }
      }
    },
    {
      id: 'qwen-image-edit',
      name: 'Qwen Image Edit',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation', 'file-input'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              outputFormat: {
                options: ['jpeg', 'png', 'webp'],
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
      id: 'qwen-image-max',
      name: 'Qwen Image Max',
      family: 'qwen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: { supports: qwenImage1T2iSupports }
        }
      }
    },
    {
      id: 'qwen-image-plus',
      name: 'Qwen Image Plus',
      family: 'qwen',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: { supports: qwenImage1T2iSupports }
        }
      }
    },
    {
      id: 'qwen-image-2-0',
      name: 'Qwen Image 2.0',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { maxInputImages: 3, supports: qwenImage20EditSupports },
          generate: { supports: qwenImage20GenerateSupports }
        }
      }
    },
    {
      id: 'qwen-image-2-0-pro',
      name: 'Qwen Image 2.0 Pro',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { maxInputImages: 3, supports: qwenImage20EditSupports },
          generate: { supports: qwenImage20GenerateSupports }
        }
      }
    },
    {
      id: 'qwen-image-2-1-pro',
      name: 'Qwen Image 2.1 Pro',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { maxInputImages: 10, supports: qwenImage21Supports },
          generate: { supports: qwenImage21Supports }
        }
      }
    },
    {
      id: 'qwen-image-2-1-turbo',
      name: 'Qwen Image 2.1 Turbo',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { maxInputImages: 10, supports: qwenImage21Supports },
          generate: { supports: qwenImage21Supports }
        }
      }
    },
    {
      id: 'qwen-image-edit-max',
      name: 'Qwen Image Edit Max',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { supports: qwenImageEditMultiSupports }
        }
      }
    },
    {
      id: 'qwen-image-edit-plus',
      name: 'Qwen Image Edit Plus',
      family: 'qwen',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: { supports: qwenImageEditMultiSupports }
        }
      }
    },
    {
      id: 'z-image-turbo',
      name: 'Z-Image Turbo',
      family: 'z-image',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: { supports: zImageTurboSupports }
        }
      }
    },
    {
      id: 'wan2-6-image',
      name: 'wan2.6-image',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              promptExtend: {
                default: true,
                type: 'switch'
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
      id: 'wan2-7-image',
      name: 'wan2.7-image',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              seed: {
                type: 'text'
              },
              thinkingMode: {
                default: true,
                type: 'switch'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-7-image-pro',
      name: 'wan2.7-image-pro',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
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
              },
              thinkingMode: {
                default: true,
                type: 'switch'
              }
            }
          }
        }
      }
    },
    {
      id: 'wan2-6-t2i',
      name: 'wan2-6-t2i',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              addWatermark: {
                type: 'switch'
              },
              imageResolution: {
                default: '1K',
                options: ['1K', '2K'],
                render: 'chips',
                type: 'enum'
              },
              negativePrompt: {
                multiline: true,
                type: 'text'
              },
              promptExtend: {
                default: true,
                type: 'switch'
              },
              seed: {
                type: 'text'
              }
            }
          }
        }
      }
    },
    // ── Rerankers (Qwen3-Reranker; models.dev carries no rerank entry, so hand-list) ──
    {
      id: 'qwen3-reranker-0-6b',
      name: 'Qwen3 Reranker 0.6B',
      family: 'qwen',
      capabilities: ['rerank'],
      contextWindow: 32768
    },
    {
      id: 'qwen3-reranker-4b',
      name: 'Qwen3 Reranker 4B',
      family: 'qwen',
      capabilities: ['rerank'],
      contextWindow: 32768
    },
    {
      id: 'qwen3-reranker-8b',
      name: 'Qwen3 Reranker 8B',
      family: 'qwen',
      capabilities: ['rerank'],
      contextWindow: 32768
    }
  ]
})
