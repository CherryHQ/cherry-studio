import type { ComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import type { ReactNode } from 'react'

export type ChatInputTokenKind = ComposerInputTokenKind

export interface ChatTokenView {
  id: string
  kind: ChatInputTokenKind
  label: string
  icon?: ReactNode
  description?: string
  promptText?: string
  payload?: unknown
}
