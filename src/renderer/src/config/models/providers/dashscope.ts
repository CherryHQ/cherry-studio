import type { Model } from '@renderer/types'

export const dashscopeModels: Model[] = [
  { id: 'qwen3.5-plus', name: 'Qwen3.5-Plus', provider: 'dashscope', group: 'Qwen' },
  { id: 'qwen3.5-flash', name: 'Qwen3.5-Flash', provider: 'dashscope', group: 'Qwen' },
  { id: 'qwen3-max', name: 'Qwen3-Max', provider: 'dashscope', group: 'Qwen' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'dashscope', group: 'Kimi' },
  { id: 'glm-5', name: 'GLM-5', provider: 'dashscope', group: 'GLM' },
  { id: 'MiniMax/MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'dashscope', group: 'MiniMax' },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', provider: 'dashscope', group: 'DeepSeek' }
]
