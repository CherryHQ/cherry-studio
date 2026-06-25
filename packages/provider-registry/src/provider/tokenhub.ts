import { defineProvider } from './types'

// Tencent's TokenHub gateway serves Hunyuan (hy/hunyuan → tencent) AND re-hosts third-party models
// (deepseek/glm/kimi/minimax/qwen → their own labs). These rows are tokenhub's served catalog: the
// (provider → model) link + the EXACT TokenHub apiModelId → canonical modelId mapping. The model
// definitions live in the labs (models.json); these don't redefine them. apiModelIds are verbatim from
// cloud.tencent.com/document/product/1823/130079 (note the date suffixes on hunyuan-2.0-*). No per-model
// pricing is published.
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
      apiKey: 'https://console.cloud.tencent.com/tokenhub/inference',
      docs: 'https://cloud.tencent.com/document/product/1823',
      models: 'https://cloud.tencent.com/document/product/1823/130079',
      official: 'https://cloud.tencent.com/product/tokenhub'
    }
  },
  overrides: [
    // Tencent-own
    { modelId: 'hy3-preview', apiModelId: 'hy3-preview' },
    { modelId: 'hunyuan-2-0-instruct', apiModelId: 'hunyuan-2.0-instruct-20251111' },
    { modelId: 'hunyuan-2-0', apiModelId: 'hunyuan-2.0-thinking-20251109' },
    { modelId: 'hy-role', apiModelId: 'hy-role' },
    { modelId: 'hy-mt2-pro', apiModelId: 'hy-mt2-pro' },
    { modelId: 'hy-mt2-plus', apiModelId: 'hy-mt2-plus' },
    { modelId: 'hy-mt2-lite', apiModelId: 'hy-mt2-lite' },
    // Tencent-own image (混元生图; doc 1823/130080). The endpoint selects the model: lite is sync
    // text→image, v3.0 is async submit/query. Param enums approximate the image sub-API.
    {
      modelId: 'hy-image-v3-0',
      apiModelId: 'hy-image-v3.0',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                type: 'enum',
                options: ['1:1', '4:3', '3:4', '16:9', '9:16'],
                default: '1:1',
                render: 'chips'
              },
              negativePrompt: { type: 'text', multiline: true },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/api/image/submit' }
          }
        }
      }
    },
    {
      modelId: 'hy-image-lite',
      apiModelId: 'hy-image-lite',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              aspectRatio: {
                type: 'enum',
                options: ['1:1', '4:3', '3:4', '16:9', '9:16'],
                default: '1:1',
                render: 'chips'
              },
              addWatermark: { type: 'switch' },
              seed: { type: 'text' }
            },
            vendorTransport: { endpoint: '/v1/api/image/lite', isSync: true }
          }
        }
      }
    },
    // re-hosted third-party
    { modelId: 'deepseek-v4-flash', apiModelId: 'deepseek-v4-flash' },
    { modelId: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash 原厂直供', apiModelId: 'deepseek-v4-flash-202605' },
    { modelId: 'deepseek-v4-pro', apiModelId: 'deepseek-v4-pro' },
    { modelId: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro 原厂直供', apiModelId: 'deepseek-v4-pro-202606' },
    { modelId: 'deepseek-v3-2', apiModelId: 'deepseek-v3.2' },
    { modelId: 'glm-5', apiModelId: 'glm-5' },
    { modelId: 'glm-5-1', apiModelId: 'glm-5.1' },
    { modelId: 'glm-5-2', apiModelId: 'glm-5.2' },
    { modelId: 'glm-5-turbo', apiModelId: 'glm-5-turbo' },
    { modelId: 'glm-5v-turbo', apiModelId: 'glm-5v-turbo' },
    { modelId: 'kimi-k2-5', apiModelId: 'kimi-k2.5' },
    { modelId: 'kimi-k2-6', apiModelId: 'kimi-k2.6' },
    { modelId: 'kimi-k2-7-code', apiModelId: 'kimi-k2.7-code' },
    { modelId: 'minimax-m2-5', apiModelId: 'minimax-m2.5' },
    { modelId: 'minimax-m2-7', apiModelId: 'minimax-m2.7' },
    { modelId: 'minimax-m3', apiModelId: 'minimax-m3' },
    { modelId: 'qwen3-5-flash', apiModelId: 'qwen3.5-flash' },
    { modelId: 'qwen3-5-plus', apiModelId: 'qwen3.5-plus' }
  ]
})
