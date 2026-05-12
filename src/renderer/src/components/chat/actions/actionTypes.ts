import type { ReactNode } from 'react'

import type { ChatMessageItem } from '../adapters/messageListAdapter'

export type ActionSurface = 'menu' | 'toolbar' | 'shortcut'

export interface ActionAvailability {
  visible: boolean
  enabled: boolean
  reason?: ReactNode
}

export type ActionAvailabilityInput = boolean | Partial<ActionAvailability> | undefined

export type ActionAvailabilityResolver<TContext> = (context: TContext) => ActionAvailabilityInput

export type ActionNode<TContext> = ReactNode | ((context: TContext) => ReactNode)

export type ActionText<TContext> = string | ((context: TContext) => string)

export type ActionSurfaceSpec = ActionSurface | readonly ActionSurface[]

export interface ActionConfirm<TContext = unknown> {
  title: ActionNode<TContext>
  description?: ActionNode<TContext>
  content?: ActionNode<TContext>
  confirmText?: ActionText<TContext>
  cancelText?: ActionText<TContext>
  destructive?: boolean
}

export interface ResolvedActionConfirm {
  title: ReactNode
  description?: ReactNode
  content?: ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

export interface CommandDescriptor<TContext> {
  id: string
  run: (context: TContext) => void | Promise<void>
  availability?: ActionAvailabilityResolver<TContext>
}

export interface ActionDescriptor<TContext> {
  id: string
  commandId?: string
  label: ActionNode<TContext>
  icon?: ActionNode<TContext>
  group?: string
  order?: number
  surface?: ActionSurfaceSpec
  danger?: boolean
  shortcut?: string
  children?: readonly ActionDescriptor<TContext>[]
  confirm?: ActionConfirm<TContext> | ((context: TContext) => ActionConfirm<TContext> | undefined)
  availability?: ActionAvailabilityResolver<TContext>
}

export interface ResolvedAction<TContext = unknown> {
  id: string
  commandId?: string
  label: ReactNode
  icon?: ReactNode
  group?: string
  order?: number
  surface?: ActionSurfaceSpec
  danger: boolean
  shortcut?: string
  confirm?: ResolvedActionConfirm
  availability: ActionAvailability
  children: ResolvedAction<TContext>[]
}

export interface MessageActionContext<Meta extends Record<string, unknown> = Record<string, unknown>> {
  message: ChatMessageItem
  selectedMessageIds?: readonly string[]
  readonly?: boolean
  meta?: Meta
}

export interface MessageActionReference<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  label?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  meta?: Meta
}

export interface MessageActionProvider<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  resolve: (context: MessageActionContext<Meta>) => readonly MessageActionReference[]
}
