import { defineProvider, type ProviderModelOffer } from './types'

type ServedModel = {
  id: string
  price: [input: number, output: number, cacheRead: number]
  context: number
  maxOutput: number
  vision?: boolean
  tools?: boolean
}

const SERVED_MODELS: ServedModel[] = [
  { id: 'deepseek/deepseek-r1', price: [0.875, 3.125, 0.875], context: 64000, maxOutput: 16000 },
  { id: 'deepseek/deepseek-v3', price: [0.32, 1.1, 0.32], context: 163840, maxOutput: 16384 },
  { id: 'deepseek/deepseek-v3.1', price: [0.56, 1.68, 0.13], context: 163840, maxOutput: 147456 },
  { id: 'deepseek/deepseek-v3.2', price: [0.28, 0.42, 0.13], context: 163840, maxOutput: 147456 },
  { id: 'deepseek/deepseek-v4-flash', price: [0.14, 0.28, 0.018], context: 1048576, maxOutput: 393216 },
  {
    id: 'deepseek/deepseek-v4-flash-vision-exp',
    price: [0.55, 1.65, 0.0175],
    context: 1048576,
    maxOutput: 262144,
    vision: true
  },
  { id: 'deepseek/deepseek-v4-pro', price: [1.625, 3.25, 0.125], context: 1048576, maxOutput: 393216 },
  { id: 'deepseek/deepseek-v4.1-flash', price: [0.3, 1.2, 0.006], context: 1048576, maxOutput: 1000000, vision: true },
  { id: 'google/gemma-3-12b-it', price: [0.0625, 0.1875, 0.0625], context: 131072, maxOutput: 16384, vision: true },
  { id: 'google/gemma-3-27b-it', price: [0.1, 0.2, 0.1], context: 131072, maxOutput: 16384, vision: true },
  { id: 'google/gemma-3-4b-it', price: [0.0625, 0.125, 0.0625], context: 131072, maxOutput: 16384, vision: true },
  { id: 'google/gemma-4-26b-a4b-it', price: [0.15, 0.6, 0.07], context: 262144, maxOutput: 16384, vision: true },
  { id: 'google/gemma-4-31b-it', price: [0.25, 0.5, 0.25], context: 262144, maxOutput: 16384, vision: true },
  { id: 'inclusionai/ling-3.0-flash', price: [0.075, 0.225, 0.015], context: 262144, maxOutput: 32768 },
  { id: 'inclusionai/ling-3.0-flash-fin', price: [0.09375, 0.275, 0.01875], context: 262144, maxOutput: 32768 },
  {
    id: 'meta-llama/llama-3.1-8b-instruct',
    price: [0.025, 0.05, 0.025],
    context: 131072,
    maxOutput: 16384,
    tools: false
  },
  { id: 'meta-llama/llama-3.3-70b-instruct', price: [0.125, 0.4, 0.125], context: 131072, maxOutput: 16384 },
  { id: 'meta-llama/llama-4-scout', price: [0.125, 0.375, 0.125], context: 327680, maxOutput: 16384, vision: true },
  { id: 'meta/muse-glimmer-30b', price: [0.375, 1.5, 0.05], context: 131072, maxOutput: 16384, vision: true },
  { id: 'minimax/minimax-m2.5', price: [0.375, 1.5, 0.0375], context: 204800, maxOutput: 131100 },
  { id: 'minimax/minimax-m2.7', price: [0.375, 1.5, 0.075], context: 204800, maxOutput: 131072 },
  { id: 'minimax/minimax-m3', price: [0.3, 1.2, 0.06], context: 524288, maxOutput: 131072, vision: true },
  { id: 'minimax/minimax-m3.1-flash', price: [0.15, 0.6, 0.015], context: 1000000, maxOutput: 943718, vision: true },
  { id: 'mistralai/mistral-nemo', price: [0.03625, 0.0375, 0.03625], context: 131072, maxOutput: 16384, tools: false },
  {
    id: 'mistralai/mistral-small-24b-instruct-2501',
    price: [0.1, 0.3, 0.1],
    context: 32768,
    maxOutput: 8192,
    tools: false
  },
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    price: [0.1, 0.3, 0.1],
    context: 128000,
    maxOutput: 16384,
    vision: true
  },
  { id: 'moonshotai/kimi-k2', price: [0.6, 2.5, 0.57], context: 131072, maxOutput: 98304 },
  { id: 'moonshotai/kimi-k2.5', price: [0.75, 3.75, 0.125], context: 262144, maxOutput: 262144, vision: true },
  { id: 'moonshotai/kimi-k2.6', price: [0.95, 4, 0.16], context: 262144, maxOutput: 262144, vision: true },
  { id: 'moonshotai/kimi-k2.7-code', price: [0.95, 4, 0.19], context: 262144, maxOutput: 262144, vision: true },
  { id: 'moonshotai/kimi-k3', price: [3, 15, 0.3], context: 1048576, maxOutput: 1048576, vision: true },
  { id: 'moonshotai/kimi-k3.1-pro', price: [2, 10, 0.2], context: 1048576, maxOutput: 1048576, vision: true },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    price: [0.09375, 0.5, 0.09375],
    context: 262144,
    maxOutput: 32768,
    tools: false
  },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', price: [0.625, 2.75, 0.125], context: 262144, maxOutput: 16384 },
  { id: 'nvidia/nemotron-3.5-lightning', price: [0.075, 0.2, 0.0375], context: 262144, maxOutput: 32768 },
  { id: 'openai/gpt-oss-120b', price: [0.04625, 0.2125, 0.04625], context: 131072, maxOutput: 117964 },
  { id: 'openai/gpt-oss-20b', price: [0.0375, 0.175, 0.0375], context: 131072, maxOutput: 117964 },
  { id: 'qwen/qwen-2.5-72b-instruct', price: [0.45, 0.5, 0.45], context: 32768, maxOutput: 8192 },
  { id: 'qwen/qwen-2.5-7b-instruct', price: [0.125, 0.25, 0.125], context: 32768, maxOutput: 8192 },
  { id: 'qwen/qwen3-14b', price: [0.35, 1.4, 0.35], context: 40960, maxOutput: 16384 },
  { id: 'qwen/qwen3-235b-a22b-2507', price: [0.23, 0.92, 0.23], context: 262144, maxOutput: 16384 },
  { id: 'qwen/qwen3-30b-a3b', price: [0.2, 0.8, 0.2], context: 40960, maxOutput: 16384 },
  { id: 'qwen/qwen3-32b', price: [0.16, 0.64, 0.16], context: 40960, maxOutput: 16384 },
  { id: 'qwen/qwen3-coder', price: [0.375, 1.25, 0.125], context: 262144, maxOutput: 65536 },
  { id: 'qwen/qwen3-next-80b-a3b-instruct', price: [0.15, 1.2, 0.15], context: 262144, maxOutput: 16384 },
  { id: 'qwen/qwen3-vl-235b-a22b-instruct', price: [0.4, 1.6, 0.4], context: 262144, maxOutput: 16384, vision: true },
  { id: 'qwen/qwen3-vl-30b-a3b-instruct', price: [0.2, 0.8, 0.2], context: 262144, maxOutput: 16384, vision: true },
  { id: 'qwen/qwen3.5-122b-a10b', price: [0.4, 3.2, 0.4], context: 262144, maxOutput: 65536, vision: true },
  { id: 'qwen/qwen3.5-27b', price: [0.3, 2.4, 0.3], context: 262144, maxOutput: 65536, vision: true },
  { id: 'qwen/qwen3.5-35b-a3b', price: [0.25, 2, 0.25], context: 262144, maxOutput: 81920, vision: true },
  { id: 'qwen/qwen3.5-397b-a17b', price: [0.6, 3.6, 0.6], context: 262144, maxOutput: 81920, vision: true },
  { id: 'qwen/qwen3.5-9b', price: [0.125, 0.1875, 0.125], context: 262144, maxOutput: 81920, vision: true },
  { id: 'qwen/qwen3.6-27b', price: [0.6, 3.6, 0.6], context: 262144, maxOutput: 81920, vision: true },
  { id: 'qwen/qwen3.6-35b-a3b', price: [0.375, 2.25, 0.375], context: 262144, maxOutput: 65536 },
  { id: 'qwen/qwen3.8-2.4t-a95b', price: [2, 6, 0.25], context: 1000000, maxOutput: 131072 },
  { id: 'qwen/qwen3.8-27b', price: [0.5, 3, 0.1], context: 262144, maxOutput: 262144 },
  { id: 'stepfun/step-3.7-flash', price: [0.2, 1.15, 0.04], context: 262144, maxOutput: 256000, vision: true },
  { id: 'stepfun/step-5-preview', price: [1, 2.7, 0.1], context: 1000000, maxOutput: 64000, vision: true },
  { id: 'tencent/hy3', price: [0.175, 0.725, 0.04375], context: 262144, maxOutput: 262144 },
  { id: 'tencent/hy4', price: [0.834, 2.501, 0.042], context: 1000000, maxOutput: 64000, vision: true },
  { id: 'tencent/hy4-flash', price: [0.07, 0.281, 0.003], context: 1000000, maxOutput: 64000, vision: true },
  {
    id: 'thinkingmachines/inkling-small',
    price: [0.5625, 1.5, 0.125],
    context: 524288,
    maxOutput: 131072,
    vision: true
  },
  { id: 'xiaomi/mimo-v2.6-flash', price: [0.14, 0.28, 0.0028], context: 1048576, maxOutput: 943718, vision: true },
  { id: 'xiaomi/mimo-v2.6-pro', price: [0.435, 0.87, 0.0036], context: 1048576, maxOutput: 943718, vision: true },
  { id: 'z-ai/glm-4.5-air', price: [0.2, 1.1, 0.03], context: 131072, maxOutput: 98304 },
  { id: 'z-ai/glm-4.5v', price: [0.6, 1.8, 0.11], context: 65536, maxOutput: 16384, vision: true },
  { id: 'z-ai/glm-4.6', price: [0.6, 2.2, 0.11], context: 202752, maxOutput: 131072 },
  { id: 'z-ai/glm-4.6v', price: [0.3, 0.9, 0.055], context: 131072, maxOutput: 32768, vision: true },
  { id: 'z-ai/glm-4.7', price: [0.6, 2.2, 0.11], context: 202752, maxOutput: 131072 },
  { id: 'z-ai/glm-4.7-flash', price: [0.0875, 0.5, 0.0125], context: 200000, maxOutput: 128000 },
  { id: 'z-ai/glm-5', price: [1, 3.2, 0.2], context: 202800, maxOutput: 131072 },
  { id: 'z-ai/glm-5.1', price: [1.4, 4.4, 0.26], context: 204800, maxOutput: 131072 },
  { id: 'z-ai/glm-5.2', price: [1.4, 4.4, 0.26], context: 1048576, maxOutput: 1048575 },
  { id: 'z-ai/glm-5.3', price: [1.4, 4.4, 0.26], context: 1048576, maxOutput: 1048575 },
  { id: 'z-ai/glm-5.3-flash', price: [0.15, 0.5, 0.03], context: 1048576, maxOutput: 1048575, vision: true }
]

const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })

type Capability = 'function-call' | 'image-recognition'

const capabilities = (vision: boolean, tools: boolean): ProviderModelOffer['capabilities'] => {
  const remove: Capability[] = [
    ...(vision ? [] : ['image-recognition' as const]),
    ...(tools ? [] : ['function-call' as const])
  ]
  return { ...(vision ? { add: ['image-recognition'] } : {}), ...(remove.length ? { remove } : {}) }
}

const toOffer = ({ id, price, context, maxOutput, vision = false, tools = true }: ServedModel): ProviderModelOffer => ({
  apiModelId: id,
  capabilities: capabilities(vision, tools),
  inputModalities: vision ? ['text', 'image'] : ['text'],
  limits: { contextWindow: context, maxOutputTokens: maxOutput },
  pricing: { input: usd(price[0]), output: usd(price[1]), cacheRead: usd(price[2]) }
})

export default defineProvider({
  id: 'morse',
  name: 'Morse',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://inference.trymorse.ai',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.trymorse.ai',
      docs: 'https://trymorse.ai/inference/docs',
      models: 'https://trymorse.ai/inference/models',
      official: 'https://trymorse.ai/inference'
    }
  },
  overrides: SERVED_MODELS.map(toOffer)
})
