import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'

import type { MessageListItem, MessageUiState } from '../types'

const WIDE_MULTI_MODEL_LAYOUTS = new Set<MultiModelMessageStyle>(['horizontal', 'grid'])

export function isAssistantMultiModelGroup(messages: MessageListItem[]): boolean {
  return messages.length > 1 && messages.every((message) => message.role === 'assistant')
}

export function getEffectiveMultiModelMessageStyle(
  messages: MessageListItem[],
  getMessageUiState: (messageId: string) => MessageUiState,
  defaultStyle: MultiModelMessageStyle
): MultiModelMessageStyle {
  if (messages.length < 2) return 'fold'

  return (getMessageUiState(messages[0]?.id).multiModelMessageStyle as MultiModelMessageStyle) || defaultStyle
}

export function shouldUseWideLayoutForMessageGroup(
  messages: MessageListItem[],
  getMessageUiState: (messageId: string) => MessageUiState,
  defaultStyle: MultiModelMessageStyle,
  isMultiSelectMode: boolean
): boolean {
  if (isMultiSelectMode || !isAssistantMultiModelGroup(messages)) return false

  return WIDE_MULTI_MODEL_LAYOUTS.has(getEffectiveMultiModelMessageStyle(messages, getMessageUiState, defaultStyle))
}
