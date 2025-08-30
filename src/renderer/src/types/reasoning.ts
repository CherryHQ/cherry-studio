import type OpenAI from 'openai'

export const ThinkModelTypes = [
  'default',
  'o',
  'gpt5',
  'grok',
  'gemini',
  'gemini_pro',
  'qwen',
  'qwen_thinking',
  'doubao',
  'doubao_no_auto',
  'hunyuan',
  'zhipu',
  'perplexity',
  'deepseek_hybrid'
] as const
export type ReasoningEffortOption = NonNullable<OpenAI.ReasoningEffort> | 'auto'
export type ThinkingOption = ReasoningEffortOption | 'off'
export type ThinkingModelType = (typeof ThinkModelTypes)[number]
export type ThinkingOptionConfig = Record<ThinkingModelType, ThinkingOption[]>
export type ReasoningEffortConfig = Record<ThinkingModelType, ReasoningEffortOption[]>
export type EffortRatio = Record<ReasoningEffortOption, number>
export function isThinkModelType(type: string): type is ThinkingModelType {
  return ThinkModelTypes.some((t) => t === type)
}
export const EFFORT_RATIO: EffortRatio = {
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  auto: 2
}
