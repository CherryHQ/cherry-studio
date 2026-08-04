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

export default openaiCompatible({
  id: 'silicon',
  name: 'Silicon',
  baseUrl: 'https://api.siliconflow.cn/v1',
  reasoningFormat: { type: 'openai-chat' },
  anthropic: 'https://api.siliconflow.cn',
  website: {
    apiKey: 'https://cloud.siliconflow.cn/',
    docs: 'https://docs.siliconflow.cn/',
    models: 'https://cloud.siliconflow.cn/models',
    official: 'https://www.siliconflow.cn'
  },
  modelsDevProvider: 'siliconflow',
  overrides: siliconReasoningModels.map((modelId) => ({
    modelId,
    reasoningContracts: {
      'openai-chat-completions': { wire: siliconReasoningWire }
    }
  }))
})
