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
    // OCR SKUs (e.g. `qwen3.5-ocr`, incl. dated snapshots like
    // `qwen3.5-ocr-2026-01-01`) reject any `thinking_budget` (Bailian reports
    // "not greater than 0", #21906). Template blocker grants no membership and
    // stops the broad Qwen toggle rule; `-ocr(?:-|$)` matches the suffix and
    // dated forms without catching unrelated ids merely containing those
    // letters. The membership profiles below exclude the same shape so ingest
    // never marks these SKUs as reasoning models.
    { pattern: '-ocr(?:-|$)', toggle: false, template: true },
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
    // Qwen3.6 plus/flash lines (incl. dated snapshots) accept up to 128K
    // thinking tokens on the Qianwen platform (#21906); must precede the
    // generic 3.5–3.7 rule since the first budget match wins. All three carry
    // the `-ocr(?:-|$)` guard so OCR SKUs (which take no budget at all) match
    // no budget rule even on paths that skip the membership gate.
    // The `(?:-|$)` closers keep future `plusfoo`-style siblings from
    // mis-bucketing into the 128K tier.
    {
      pattern: '^(?!.*-ocr(?:-|$))qwen3[.-]6-(?:plus|flash|max-preview)(?:-|$)',
      budget: { min: 0, max: 131072 },
      template: true
    },
    {
      pattern: '^(?!.*-ocr(?:-|$))qwen3[.-][5-7](?!\\d)',
      budget: { min: 0, max: 81920 },
      template: true
    },
    // Unanchored by design: token-limit callers may pass namespaced ids, so
    // budget-only rules must stay matchable beyond position 0. The leading
    // guard still excludes OCR at every position the `qwen3` literal can
    // match, since the literal occurs only once in these ids.
    {
      pattern: '(?!.*-ocr(?:-|$))qwen3-(?!max)(?!\\d+[.-]max).*$',
      budget: { min: 1024, max: 38912 },
      template: true
    },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^qwen3.*thinking' },
    { pattern: 'qwq|qvq' },
    { pattern: '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking|-ocr(?:-|$)))qwen-?3[.-][5-9](?!\\d)' },
    {
      pattern:
        '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking|-ocr(?:-|$)))(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)'
    },
    {
      pattern:
        '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking|-ocr(?:-|$)))qwen(?:3[.-][5-9])?-(?:plus|flash|turbo)(?:-|$)'
    },
    { pattern: '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking|-ocr(?:-|$)))qwen-?3-\\d' },
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
