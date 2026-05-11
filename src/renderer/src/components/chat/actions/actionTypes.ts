import type { ReactNode } from 'react'

import type { ChatMessageItem } from '../adapters/messageListAdapter'

export interface MessageActionContext<Meta extends Record<string, unknown> = Record<string, unknown>> {
  message: ChatMessageItem
  selectedMessageIds?: readonly string[]
  readonly?: boolean
  meta?: Meta
}

export interface MessageActionReference<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  label?: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  meta?: Meta
}

export interface MessageActionProvider<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  resolve: (context: MessageActionContext<Meta>) => readonly MessageActionReference[]
}
