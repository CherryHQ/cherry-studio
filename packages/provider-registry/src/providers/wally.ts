import type { ModelCapability, ReasoningEffort } from '../schemas/enums'
import { openaiCompatible, type ProviderModelOffer } from './types'

const usd = (perMillionTokens: number) => ({ currency: 'USD' as const, perMillionTokens })

/** Served models as listed by https://inference.runanywhere.ai/v1/models; prices are USD per million tokens. */
const models: Array<{
  apiModelId: string
  /** Own catalog key for a dated snapshot that would otherwise share its base model's key. */
  modelId?: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  image: boolean
  structuredOutput: boolean
  price: [input: number, output: number, cacheRead: number]
  efforts: ReasoningEffort[]
  defaultEffort?: ReasoningEffort
}> = [
  {
    apiModelId: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    image: false,
    structuredOutput: true,
    price: [0.15, 0.5, 0.03],
    efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'max'
  },
  {
    apiModelId: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: true,
    structuredOutput: true,
    price: [0.275, 1.2, 0.006],
    efforts: ['none', 'low', 'medium', 'high', 'max'],
    defaultEffort: 'high'
  },
  {
    apiModelId: 'kimi-k3',
    name: 'Kimi K3',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: true,
    structuredOutput: true,
    price: [2.925, 15, 0.3],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    apiModelId: 'deepseek-v4.1-flash-fast',
    name: 'DeepSeek V4.1 Flash (Fast)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: true,
    structuredOutput: true,
    price: [0.275, 1.2, 0.006],
    efforts: ['none', 'low', 'medium', 'high', 'max'],
    defaultEffort: 'high'
  },
  {
    apiModelId: 'glm-5.3-fast',
    name: 'GLM-5.3 (Fast)',
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    image: false,
    structuredOutput: true,
    price: [1.4, 4.4, 0.26],
    efforts: ['low', 'medium', 'high', 'max']
  },
  {
    apiModelId: 'deepseek-v4-pro-fast',
    name: 'DeepSeek V4 Pro (Fast)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: false,
    structuredOutput: true,
    price: [1.68, 3.38, 0.14],
    efforts: ['none', 'minimal', 'low', 'medium', 'high', 'max']
  },
  {
    apiModelId: 'deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash 0731',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: false,
    structuredOutput: true,
    price: [0.293, 0.88, 0.0093],
    efforts: ['none', 'minimal', 'low', 'medium', 'high', 'max']
  },
  {
    apiModelId: 'minimax-m3',
    name: 'MiniMax M3',
    contextWindow: 524_287,
    maxOutputTokens: 131_072,
    image: false,
    structuredOutput: true,
    price: [0.3, 1.2, 0.06],
    efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    apiModelId: 'deepseek-v4.1-flash-1017',
    modelId: 'deepseek-v4-1-flash-1017',
    name: 'DeepSeek V4.1 Flash 1017',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    image: false,
    structuredOutput: false,
    price: [0.195, 1, 0.006],
    efforts: ['none', 'minimal', 'low', 'medium', 'high', 'max'],
    defaultEffort: 'high'
  }
]

// Capabilities and modalities are forced: base entries for several of these models accept image or video input that Wally does not serve.
const overrides: ProviderModelOffer[] = models.map((m) => ({
  apiModelId: m.apiModelId,
  ...(m.modelId ? { modelId: m.modelId } : {}),
  name: m.name,
  capabilities: {
    force: [
      'function-call',
      'reasoning',
      ...(m.structuredOutput ? ['structured-output'] : []),
      ...(m.image ? ['image-recognition'] : [])
    ] as ModelCapability[]
  },
  inputModalities: m.image ? ['text', 'image'] : ['text'],
  outputModalities: ['text'],
  limits: { contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens },
  pricing: { input: usd(m.price[0]), output: usd(m.price[1]), cacheRead: usd(m.price[2]) },
  reasoningContracts: {
    'openai-chat-completions': {
      support: {
        controls: [{ kind: 'effort', values: m.efforts, ...(m.defaultEffort ? { default: m.defaultEffort } : {}) }],
        ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {})
      }
    }
  }
}))

export default openaiCompatible({
  id: 'wally',
  name: 'Wally',
  availableInEditions: ['global'],
  baseUrl: 'https://inference.runanywhere.ai/v1',
  reasoningFormat: { type: 'openai-chat' },
  website: {
    apiKey: 'https://console.runanywhere.ai',
    docs: 'https://docs.runanywhere.ai/wally-cloud/api',
    models: 'https://www.runwally.com/pricing',
    official: 'https://www.runwally.com'
  },
  overrides
})
