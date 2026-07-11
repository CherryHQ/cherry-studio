import type { ReactNode } from 'react'

export const CHAT_INPUT_TOKEN_KINDS = ['skill', 'file', 'folder', 'knowledge', 'quote', 'promptVariable'] as const

export type ChatInputTokenKind = (typeof CHAT_INPUT_TOKEN_KINDS)[number]

export interface ChatTokenView {
  id: string
  kind: ChatInputTokenKind
  label: string
  icon?: ReactNode
  description?: string
  promptText?: string
  payload?: unknown
}
