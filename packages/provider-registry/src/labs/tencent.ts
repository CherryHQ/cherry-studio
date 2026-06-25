import { defineLab } from './types'

// Tencent serves Hunyuan through TokenHub (a multi-vendor gateway that also re-hosts deepseek/glm/kimi/…),
// so there's no clean hunyuan-only API to fetch — listing it would over-claim third-party models. Hand-listed;
// context/output limits + capabilities verified against TokenHub docs (cloud.tencent.com/document/product/1823/130051).
// tokenhub stays the gateway PROVIDER. Pricing isn't published per-model (hy3/a13b get theirs from OpenRouter);
// turbos/t1 context aren't documented there, left unset rather than guessed.
export default defineLab({
  id: 'tencent',
  name: 'Tencent (Hunyuan)',
  families: ['hunyuan'],
  idPrefixes: ['hunyuan', 'hy'],
  webSearch: ['hunyuan'],
  models: [
    { id: 'hunyuan-turbos', name: 'Hunyuan TurboS', capabilities: ['function-call'] },
    { id: 'hunyuan-t1', name: 'Hunyuan T1', capabilities: ['reasoning', 'function-call'] },
    {
      id: 'hunyuan-a13b-instruct',
      name: 'Hunyuan A13B Instruct',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    {
      id: 'hy3-preview',
      name: 'Hunyuan 3 Preview',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 262144,
      maxInputTokens: 196608,
      maxOutputTokens: 131072
    },
    {
      id: 'hunyuan-2-0-thinking',
      name: 'Hunyuan 2.0 Thinking',
      capabilities: ['reasoning', 'function-call'],
      contextWindow: 196608,
      maxInputTokens: 131072,
      maxOutputTokens: 65536
    },
    {
      id: 'hunyuan-2-0-instruct',
      name: 'Hunyuan 2.0 Instruct',
      capabilities: ['function-call'],
      contextWindow: 147456,
      maxInputTokens: 131072,
      maxOutputTokens: 16384
    },
    { id: 'tc-code', name: 'Tencent Code', capabilities: ['function-call'] },
    { id: 'hy-role', name: 'Hunyuan Role', contextWindow: 32768, maxInputTokens: 28672, maxOutputTokens: 4096 },
    { id: 'hy-mt2-pro', name: 'Hunyuan MT2 Pro', contextWindow: 8192, maxOutputTokens: 4096 },
    { id: 'hy-mt2-plus', name: 'Hunyuan MT2 Plus', contextWindow: 8192, maxOutputTokens: 4096 },
    { id: 'hy-mt2-lite', name: 'Hunyuan MT2 Lite', contextWindow: 8192, maxOutputTokens: 4096 },
    // HY-Image painting models (cloud.tencent.com/document/product/1823/130080). v3.0 is text→image AND
    // image→image (async submit/query; `images` array of urls); lite is text→image only (sync). The
    // exact size/aspectRatio enum lives in the sub-API (1668/120721, /124632) — options below approximate it.
    {
      id: 'hy-image-v3-0',
      name: 'Hunyuan Image 3.0',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
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
      id: 'hy-image-lite',
      name: 'Hunyuan Image Lite',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image'],
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
            vendorTransport: { endpoint: '/v1/api/image/lite' }
          }
        }
      }
    }
  ]
})
