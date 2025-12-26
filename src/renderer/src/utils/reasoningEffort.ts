import type { ThinkingOption } from '@renderer/types'

/**
 * Thinking 块中用于记录“思考程度”的 metadata 字段名。
 * 用于在消息回放时展示与当次请求一致的文案。
 */
export const THINKING_BLOCK_REASONING_EFFORT_KEY = 'reasoning_effort' as const

export type DisplayableReasoningEffortOption = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export function normalizeDisplayableReasoningEffort(
  option?: ThinkingOption
): DisplayableReasoningEffortOption | undefined {
  if (!option) return undefined
  if (option === 'minimal' || option === 'low' || option === 'medium' || option === 'high' || option === 'xhigh') {
    return option
  }
  return undefined
}

/**
 * 获取用于展示的 i18n key。
 * - 仅对可展示的思考程度返回 key
 * - `default/auto/none` 等返回 `undefined`，交由上层回退为“已深度思考”
 */
export function getReasoningEffortLabelI18nKey(option?: ThinkingOption): string | undefined {
  const normalized = normalizeDisplayableReasoningEffort(option)
  if (!normalized) return undefined
  return `assistants.settings.reasoning_effort.${normalized}` as const
}
