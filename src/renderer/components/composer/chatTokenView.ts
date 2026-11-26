import type { ReactNode } from 'react'

import type { ComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'

export type ChatInputTokenKind = ComposerInputTokenKind

export interface ChatTokenView {
  id: string
  kind: ChatInputTokenKind
  label: string
  icon?: ReactNode
  description?: string
  sourceMessageId?: string
  promptText?: string
  payload?: unknown
}
