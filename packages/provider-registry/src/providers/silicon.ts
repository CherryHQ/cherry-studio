import { openaiCompatible } from './types'

const siliconReasoningWire = {
  off: { operations: [{ target: 'enable_thinking' as const, value: { source: 'literal' as const, value: false } }] },
  auto: {
    operations: [
      { target: 'enable_thinking' as const, value: { source: 'literal' as const, value: true } },
      { target: 'thinking_budget' as const, value: { source: 'budget' as const } }
    ],
    budget: { min: 32_768, missing: { type: 'omit-value' as const } }
  },
  effort: {
    operations: [
      { target: 'enable_thinking' as const, value: { source: 'literal' as const, value: true } },
      { target: 'thinking_budget' as const, value: { source: 'budget' as const } }
    ],
    budget: { min: 32_768, missing: { type: 'omit-value' as const } }
  }
}

const siliconReasoningModels = [
  'deepseek-v3-1',
  'deepseek-v3-1-terminus',
  'deepseek-v3-2',
  'deepseek-v3-2-exp',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-4-5-air',
  'glm-5',
  'glm-5-1',
  'glm-5-2',
  'glm-5v-turbo',
  'hunyuan-a13b-instruct',
  'qwen3-14b',
  'qwen3-32b',
  'qwen3-235b-a22b',
  'qwen3-5-9b',
  'qwen3-5-27b',
  'qwen3-5-35b-a3b',
  'qwen3-5-122b-a10b',
  'qwen3-5-397b-a17b',
  'qwen3-6-27b',
  'qwen3-6-35b-a3b',
  'qwen3-8b',
  'qwen3-vl-30b-a3b',
  'qwen3-vl-235b-a22b'
]

// ── Image generation ─────────────────────────────────────────────────────────
// Every SiliconFlow image model POSTs to the same sync `/images/generations`
// endpoint (the transport's default), so no vendorTransport is needed.
// Watermark control is a request header (`X-Enable-Watermark: 0|1`, default on)
// — the app's silicon image transport maps the `addWatermark` switch to it.
// Docs: https://docs.siliconflow.cn/cn/api-reference/images/images-generations
//       https://api-docs.siliconflow.cn/docs/api/images-generations-post

const siliconAddWatermark = { default: true, type: 'switch' } as const

const siliconImageOverrides = [
  {
    modelId: 'kolors',
    apiModelId: 'Kwai-Kolors/Kolors',
    imageGeneration: {
      modes: {
        generate: {
          supports: {
            addWatermark: siliconAddWatermark,
            // Kolors-only knobs: `guidance_scale` (docs cap it at 20) and the
            // only model honoring `batch_size` (1-4).
            guidanceScale: { default: 7.5, max: 20, min: 0, step: 0.5, type: 'range' },
            negativePrompt: { type: 'text' },
            numImages: { default: 1, max: 4, min: 1, type: 'range' },
            numInferenceSteps: { default: 20, max: 100, min: 1, type: 'range' },
            seed: { type: 'text' },
            size: {
              default: '1024x1024',
              options: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'],
              render: 'chips',
              type: 'enum'
            }
          }
        }
      }
    }
  },
  {
    modelId: 'qwen-image',
    apiModelId: 'Qwen/Qwen-Image',
    imageGeneration: {
      modes: {
        generate: {
          supports: {
            addWatermark: siliconAddWatermark,
            // Qwen-Image's CFG replaces Kolors' guidance_scale; >1 is required
            // for in-image text, and the vendor's quality config is 50 steps
            // at CFG 4.0.
            cfg: { default: 4, max: 20, min: 0.1, step: 0.1, type: 'range' },
            negativePrompt: { type: 'text' },
            numInferenceSteps: { default: 50, max: 100, min: 1, type: 'range' },
            seed: { type: 'text' },
            size: {
              default: '1328x1328',
              options: ['1328x1328', '1664x928', '928x1664', '1472x1140', '1140x1472', '1584x1056', '1056x1584'],
              render: 'chips',
              type: 'enum'
            }
          }
        }
      }
    }
  },
  {
    modelId: 'qwen-image-edit',
    apiModelId: 'Qwen/Qwen-Image-Edit',
    inputModalities: ['text', 'image'],
    imageGeneration: {
      modes: {
        // The Edit variants ignore `image_size` — no size field.
        edit: {
          maxInputImages: 1,
          supports: {
            addWatermark: siliconAddWatermark,
            negativePrompt: { type: 'text' },
            seed: { type: 'text' }
          }
        }
      }
    }
  },
  {
    modelId: 'qwen-image-edit-2509',
    apiModelId: 'Qwen/Qwen-Image-Edit-2509',
    name: 'Qwen-Image-Edit 2509',
    inputModalities: ['text', 'image'],
    imageGeneration: {
      modes: {
        edit: {
          // The 2509 refresh takes up to three reference images
          // (`image` / `image2` / `image3`).
          maxInputImages: 3,
          supports: {
            addWatermark: siliconAddWatermark,
            negativePrompt: { type: 'text' },
            seed: { type: 'text' }
          }
        }
      }
    }
  },
  {
    modelId: 'z-image-turbo',
    apiModelId: 'Tongyi-MAI/Z-Image-Turbo',
    name: 'Z-Image Turbo',
    imageGeneration: {
      modes: {
        generate: {
          supports: {
            addWatermark: siliconAddWatermark,
            negativePrompt: { type: 'text' },
            seed: { type: 'text' },
            size: {
              default: '1024x1024',
              options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
              render: 'chips',
              type: 'enum'
            }
          }
        }
      }
    }
  },
  {
    modelId: 'z-image',
    apiModelId: 'Tongyi-MAI/Z-Image',
    name: 'Z-Image',
    imageGeneration: {
      modes: {
        generate: {
          supports: {
            addWatermark: siliconAddWatermark,
            negativePrompt: { type: 'text' },
            numInferenceSteps: { default: 50, max: 100, min: 1, type: 'range' },
            seed: { type: 'text' },
            size: {
              default: '1024x1024',
              options: ['1024x1024', '1024x1536', '1536x1024', '1536x1536', '768x1024', '1024x768'],
              render: 'chips',
              type: 'enum'
            }
          }
        }
      }
    }
  }
]

export default openaiCompatible({
  id: 'silicon',
  name: 'Silicon',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.siliconflow.cn/v1',
  reasoningFormat: { type: 'openai-chat' },
  anthropic: 'https://api.siliconflow.cn',
  website: {
    apiKey: 'https://cloud.siliconflow.cn/i/d1nTBKXU',
    docs: 'https://docs.siliconflow.cn/',
    models: 'https://cloud.siliconflow.cn/models',
    official: 'https://www.siliconflow.cn'
  },
  modelsDevProvider: 'siliconflow',
  overrides: [
    ...siliconImageOverrides,
    ...siliconReasoningModels.map((modelId) => ({
      modelId,
      reasoningContracts: {
        'openai-chat-completions': { wire: siliconReasoningWire }
      }
    }))
  ]
})
