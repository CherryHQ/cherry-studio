import type { ProviderModelOverride } from '../schemas/provider-models'
import { openaiCompatible } from './types'

// iFlytek's MaaS ids are opaque and separator-less (`xop3qwen0b6embedding`), so `normalizeModelId`
// can never fold them onto a catalog row — every served id needs an explicit apiModelId mapping.
// Capabilities come from the mapped base rows, which is what keeps the embedding/rerank models out
// of chat selectors (#18883). Shared with the Coding Plan provider, which serves the same SKUs.
export const XFYUN_MODEL_OVERRIDES: Partial<ProviderModelOverride>[] = [
  // iFlytek's own models (see creators/iflytek.ts).
  { modelId: 'spark-x2-agent', apiModelId: 'xsparkx2agent' },
  { modelId: 'spark-x2', apiModelId: 'xsparkx2' },
  { modelId: 'spark-x2-flash', apiModelId: 'xsparkx2flash' },
  // Hosted open-weight models.
  { modelId: 'glm-5-2', apiModelId: 'xopglm52' },
  { modelId: 'glm-5-1', apiModelId: 'xopglm51' },
  { modelId: 'glm-5', apiModelId: 'xopglm5' },
  { modelId: 'glm-4-7-flash', apiModelId: 'xopglmv47flash' },
  { modelId: 'deepseek-v4-pro', apiModelId: 'xopdeepseekv4pro' },
  { modelId: 'deepseek-v4-flash', apiModelId: 'xopdeepseekv4flash' },
  { modelId: 'deepseek-v3-2', apiModelId: 'xopdeepseekv32' },
  { modelId: 'deepseek-v3', apiModelId: 'xdeepseekv3' },
  { modelId: 'kimi-k2-7-code', apiModelId: 'xopkimi27code' },
  { modelId: 'kimi-k2-6', apiModelId: 'xopkimik26' },
  { modelId: 'kimi-k2-5', apiModelId: 'xopkimik25' },
  { modelId: 'minimax-m2-5', apiModelId: 'xminimaxm25' },
  { modelId: 'qwen3-5-397b-a17b', apiModelId: 'xopqwen35397b' },
  { modelId: 'qwen3-6-35b-a3b', apiModelId: 'xopqwen36v35b' },
  { modelId: 'qwen3-5-35b-a3b', apiModelId: 'xopqwen35v35b' },
  { modelId: 'qwen3-coder-next', apiModelId: 'xop3qwencodernext' }
]

export default openaiCompatible({
  id: 'xfyun',
  name: 'iFlytek Astron MaaS',
  baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
  website: {
    apiKey: 'https://training.xfyun.cn/modelService',
    docs: 'https://www.xfyun.cn/doc/spark/%E6%8E%A8%E7%90%86%E6%9C%8D%E5%8A%A1-http.html',
    models: 'https://training.xfyun.cn/modelSquare',
    official: 'https://training.xfyun.cn'
  },
  overrides: [
    ...XFYUN_MODEL_OVERRIDES,
    // Embedding / rerank — served on `/embeddings` and `/rerank` of the same host.
    { modelId: 'qwen3-embedding-0-6b', apiModelId: 'xop3qwen0b6embedding' },
    { modelId: 'qwen3-reranker-0-6b', apiModelId: 'xop3qwen0b6reranker' }
  ]
})
