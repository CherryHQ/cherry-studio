import { loggerService } from '@logger'
import { QuickPanelListItem, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { type Assistant, type Model, TopicType } from '@renderer/types'
import { TFunction } from 'i18next'
import React from 'react'

import { InputbarToolsContextValue } from './context/InputbarToolsProvider'

export { TopicType }

const logger = loggerService.withContext('InputbarToolsRegistry')

export type InputbarScope = TopicType | 'mini-window'

export interface InputbarScopeConfig {
  features: InputbarFeatures
  placeholder?: string
  minRows?: number
  maxRows?: number
  showTokenCount?: boolean
  showTools?: boolean
  toolsCollapsible?: boolean
  enableQuickPanel?: boolean
  enableDragDrop?: boolean
}

export interface InputbarFeatures {
  enableAttachments: boolean
  enableKnowledge: boolean
  enableMentionModels: boolean
  enableTranslate: boolean
  enableWebSearch: boolean
  enableMCPTools: boolean
  enableGenImage: boolean
  enableThinking: boolean
  enableUrlContext: boolean
  enableQuickPhrases: boolean
  enableNewTopic: boolean
  enableClearTopic: boolean
  enableExpand: boolean
  enableNewContext: boolean
  enableSendButton: boolean
  enableAbortButton: boolean
}

type ReadableKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K
}[keyof T]

type ActionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never
}[keyof T]

type ToolStateKeys = Exclude<ReadableKeys<InputbarToolsContextValue>, 'quickPanelRootMenu'>
type ToolActionKeys = Exclude<
  ActionKeys<InputbarToolsContextValue>,
  'registerQuickPanelRootMenu' | 'registerQuickPanelTrigger' | 'emitQuickPanelTrigger'
>

export type ToolStateMap = Pick<InputbarToolsContextValue, ToolStateKeys>
export type ToolActionMap = Pick<InputbarToolsContextValue, ToolActionKeys>

export type ToolStateKey = keyof ToolStateMap
export type ToolActionKey = keyof ToolActionMap

export interface ToolDependencies {
  hooks?: string[]
  state?: ToolStateKeys[]
  actions?: ToolActionKeys[]
}

export interface ToolContext {
  scope: InputbarScope
  assistant: Assistant
  model: Model
  features: InputbarFeatures
}

export interface ToolQuickPanelApi {
  registerRootMenu: (entries: QuickPanelListItem[]) => () => void
  registerTrigger: (symbol: QuickPanelReservedSymbol, handler: (payload?: unknown) => void) => () => void
  emitTrigger: (symbol: QuickPanelReservedSymbol, payload?: unknown) => void
}

export type ToolRenderContext<S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]> = ToolContext & {
  state: Pick<ToolStateMap, S[number]>
  actions: Pick<ToolActionMap, A[number]>
  quickPanel: ToolQuickPanelApi
  t: TFunction
}

export interface ToolQuickPanelCapabilities {
  rootMenu?: boolean
  triggers?: QuickPanelReservedSymbol[]
}

export interface ToolDefinition<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  key: string
  label: string | ((t: TFunction) => string)
  icon?: React.ComponentType<{ size?: number }>

  // Visibility and conditions
  condition?: (context: ToolContext) => boolean
  visibleInScopes?: InputbarScope[]
  defaultHidden?: boolean

  // Dependencies
  dependencies?: {
    state?: S
    actions?: A
  }

  // Quick panel integration metadata
  quickPanel?: ToolQuickPanelCapabilities

  // Render function
  render: (context: ToolRenderContext<S, A>) => React.ReactNode
}

export const defineTool = <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
  tool: ToolDefinition<S, A>
) => tool

// Tool registry
const toolRegistry = new Map<string, ToolDefinition>()

export const registerTool = (tool: ToolDefinition): void => {
  if (toolRegistry.has(tool.key)) {
    logger.warn(`Tool with key "${tool.key}" is already registered. Overwriting.`)
  }
  toolRegistry.set(tool.key, tool)
}

export const getTool = (key: string): ToolDefinition | undefined => {
  return toolRegistry.get(key)
}

export const getAllTools = (): ToolDefinition[] => {
  return Array.from(toolRegistry.values())
}

export const getToolsForScope = (scope: InputbarScope, context: Omit<ToolContext, 'scope'>): ToolDefinition[] => {
  const fullContext: ToolContext = { ...context, scope }

  return getAllTools().filter((tool) => {
    // Check scope visibility
    if (tool.visibleInScopes && !tool.visibleInScopes.includes(scope)) {
      return false
    }

    // Check custom condition
    if (tool.condition && !tool.condition(fullContext)) {
      return false
    }

    return true
  })
}

// Tool order configuration
export interface ToolOrderConfig {
  visible: string[]
  hidden: string[]
}

const defaultToolOrder: Record<InputbarScope, ToolOrderConfig> = {
  [TopicType.Chat]: {
    visible: [
      'new_topic',
      'attachment',
      'thinking',
      'web_search',
      'url_context',
      'knowledge_base',
      'mcp_tools',
      'generate_image',
      'mention_models',
      'quick_phrases',
      'clear_topic',
      'toggle_expand',
      'new_context'
    ],
    hidden: []
  },
  [TopicType.Session]: {
    visible: [],
    hidden: []
  },
  'mini-window': {
    visible: ['attachment', 'mention_models', 'quick_phrases'],
    hidden: []
  }
}

export const getDefaultToolOrder = (scope: InputbarScope): ToolOrderConfig => {
  return defaultToolOrder[scope] || defaultToolOrder[TopicType.Chat]
}
