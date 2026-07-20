import { defineCreator } from './types'

export default defineCreator({
  id: 'alibaba',
  name: 'Alibaba (Qwen)',
  modelsDevProviders: ['alibaba', 'alibaba-cn'],
  families: ['qwen', 'qvq'],
  idPrefixes: ['qwen', 'qvq', 'tongyi'],
  reasoningFamilies: [
    // Always-think SKUs: thinking cannot be disabled — the explicit
    // `toggle: false` stops the generic qwen rule below; budget still applies.
    { pattern: '^qwen3(?:-vl)?-.*thinking', toggle: false },
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
    { pattern: '^qwen3[.-][5-9](?!\\d)', budget: { min: 0, max: 81920 }, template: true },
    { pattern: 'qwen3-(?!max).*$', budget: { min: 1024, max: 38912 }, template: true },
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
