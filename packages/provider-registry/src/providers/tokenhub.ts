import { defineProvider } from './types'

// Tencent's TokenHub gateway serves Hunyuan (hy/hunyuan → tencent) AND re-hosts third-party models
// (deepseek/glm/kimi/minimax/qwen → their own creators). These rows are tokenhub's served catalog: the
// (provider → model) link + the EXACT TokenHub apiModelId → canonical modelId mapping. The model
// definitions live in the creators (models.json); these don't redefine them. apiModelIds are verbatim from
// cloud.tencent.com/document/product/1823/130079 (note the date suffixes on hunyuan-2.0-*). No per-model
// pricing is published.
//
// Image models (cloud.tencent.com/document/product/1823/130080) are NOT OpenAI-compatible: each family has
// its own `/v1/wand/*` endpoint (hunyuan / seedream sync, vidu async submit+poll), carried here as
// `vendorTransport` and executed by main's tokenhub image transport. The full `imageGeneration` block is
// restated per row because the runtime replaces it wholesale (Design B).
export default defineProvider({
  id: 'tokenhub',
  name: 'TokenHub',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://tokenhub.tencentmaas.com' },
    'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://tokenhub.tencentmaas.com/v1' }
  },
  metadata: {
    website: {
      apiKey: 'https://console.cloud.tencent.com/tokenhub/apikey',
      docs: 'https://cloud.tencent.com/document/product/1823',
      models: 'https://cloud.tencent.com/document/product/1823/130079',
      official: 'https://cloud.tencent.com/product/tokenhub'
    }
  },
  modelListSource: 'registry',
  overrides: [
    // Tencent-own
    { modelId: 'hy4-preview', apiModelId: 'hy4-preview' },
    { modelId: 'hy-role', apiModelId: 'hy-role' },
    { modelId: 'hy-mt2-pro', apiModelId: 'hy-mt2-pro' },
    { modelId: 'hy-mt2-plus', apiModelId: 'hy-mt2-plus' },
    { modelId: 'hy-mt2-lite', apiModelId: 'hy-mt2-lite' },
    // re-hosted third-party
    { modelId: 'deepseek-v4-flash', apiModelId: 'deepseek-v4-flash' },
    { modelId: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash 原厂直供', apiModelId: 'deepseek-v4-flash-202605' },
    { modelId: 'deepseek-v4-pro', apiModelId: 'deepseek-v4-pro' },
    { modelId: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro 原厂直供', apiModelId: 'deepseek-v4-pro-202606' },
    { modelId: 'glm-5', apiModelId: 'glm-5' },
    { modelId: 'glm-5-1', apiModelId: 'glm-5.1' },
    { modelId: 'glm-5-2', apiModelId: 'glm-5.2' },
    { modelId: 'glm-5-turbo', apiModelId: 'glm-5-turbo' },
    { modelId: 'glm-5v-turbo', apiModelId: 'glm-5v-turbo' },
    { modelId: 'kimi-k2-5', apiModelId: 'kimi-k2.5' },
    { modelId: 'kimi-k2-6', apiModelId: 'kimi-k2.6' },
    { modelId: 'kimi-k2-7-code', apiModelId: 'kimi-k2.7-code' },
    { modelId: 'minimax-m2-7', apiModelId: 'minimax-m2.7' },
    { modelId: 'minimax-m3', apiModelId: 'minimax-m3' },
    { modelId: 'qwen3-5-flash', apiModelId: 'qwen3.5-flash' },
    { modelId: 'qwen3-5-plus', apiModelId: 'qwen3.5-plus' },
    // image (1823/135745 — hy, 1823/136609 — seedream, 1823/135746 — vidu)
    {
      modelId: 'hy-image-v3-0',
      apiModelId: 'hy-image-v3',
      inputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 3,
            supports: {
              size: {
                type: 'enum',
                options: ['1024x1024', '1280x768', '768x1280', '1024x768', '768x1024', 'custom'],
                default: '1024x1024',
                render: 'chips'
              },
              customSize: { type: 'size', minSide: 512, maxSide: 2048, pairedEnumKey: 'size' },
              seed: { type: 'text' },
              promptEnhancement: { type: 'switch', default: false }
            },
            vendorTransport: { endpoint: '/v1/wand/hunyuan-image/v3-generation', isSync: true }
          }
        }
      }
    },
    {
      modelId: 'doubao-seedream-5-0-pro',
      apiModelId: 'seedream-image-v5.0-pro',
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 10,
            supports: {
              imageResolution: { type: 'enum', options: ['1K', '1.5K', '2K'], default: '2K', render: 'chips' },
              outputFormat: { type: 'enum', options: ['jpeg', 'png'], default: 'jpeg' },
              addWatermark: { type: 'switch' }
            },
            vendorTransport: { endpoint: '/v1/wand/si-image/generation', isSync: true }
          }
        }
      }
    },
    {
      modelId: 'doubao-seedream-5-0-lite',
      apiModelId: 'seedream-image-v5.0-lite',
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 14,
            supports: {
              imageResolution: { type: 'enum', options: ['2K', '3K', '4K'], default: '2K', render: 'chips' },
              outputFormat: { type: 'enum', options: ['jpeg', 'png'], default: 'jpeg' },
              addWatermark: { type: 'switch' },
              sequentialImageGeneration: { type: 'enum', options: ['disabled', 'auto'], default: 'disabled' },
              maxImages: { type: 'range', min: 1, max: 15, default: 15 }
            },
            vendorTransport: { endpoint: '/v1/wand/si-image/generation', isSync: true }
          }
        }
      }
    },
    {
      modelId: 'viduq2',
      apiModelId: 'vidu-image-q2',
      inputModalities: ['text', 'image'],
      imageGeneration: {
        modes: {
          generate: {
            maxInputImages: 7,
            supports: {
              aspectRatio: {
                type: 'enum',
                options: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '2:3', '3:2'],
                default: '16:9',
                render: 'chips'
              },
              resolution: { type: 'enum', options: ['1080p', '2K', '4K'], default: '1080p', render: 'chips' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/wand/vidu-image/generation' }
          }
        }
      }
    }
  ]
})
