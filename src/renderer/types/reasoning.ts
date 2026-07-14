import type { ReasoningEffortOption } from '@shared/utils/reasoning'

export type { ReasoningEffortOption }
export type { EffortRatio } from '@shared/utils/reasoning'
export { EFFORT_RATIO } from '@shared/utils/reasoning'

const ThinkModelTypes = [
  'default',
  'o',
  'openai_deep_research',
  'gpt5',
  'gpt5_1',
  'gpt5_codex',
  'gpt5_1_codex',
  'gpt5_1_codex_max',
  'gpt5_2_codex',
  'gpt5_2',
  'gpt5pro',
  'gpt52pro',
  'gpt_oss',
  'grok',
  'grok4_fast',
  'grok_4_3',
  'gemini2_flash',
  'gemini2_pro',
  'gemini3_flash',
  'gemini3_pro',
  'gemini3_1_pro',
  'gemma4_hosted',
  'qwen',
  'qwen_thinking',
  'doubao',
  'doubao_no_auto',
  'doubao_after_251015',
  'mimo',
  'hunyuan',
  'zhipu',
  'perplexity',
  'deepseek_hybrid',
  'deepseek_v4',
  'kimi_k2_5',
  'claude',
  'claude46',
  'mistral'
] as const

export type ThinkingOption = ReasoningEffortOption
export type ThinkingModelType = (typeof ThinkModelTypes)[number]
export type ThinkingOptionConfig = Record<ThinkingModelType, ThinkingOption[]>
export type ReasoningEffortConfig = Record<ThinkingModelType, ReasoningEffortOption[]>
