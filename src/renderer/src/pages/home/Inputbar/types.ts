import { loggerService } from '@logger'
import type {
  QuickPanelCloseAction,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelReservedSymbol
} from '@renderer/components/QuickPanel'
import { type Assistant, type Model, TopicType } from '@renderer/types'
import type { InputBarToolType } from '@renderer/types/chat'
import type { TFunction } from 'i18next'
import React from 'react'

import type { InputbarToolsContextValue } from './context/InputbarToolsProvider'

export { TopicType }

const logger = loggerService.withContext('InputbarToolsRegistry')

export type InputbarScope = TopicType | 'mini-window'

export interface InputbarScopeConfig {
  placeholder?: string
  minRows?: number
  maxRows?: number
  showTokenCount?: boolean
  showTools?: boolean
  toolsCollapsible?: boolean
  enableQuickPanel?: boolean
  enableDragDrop?: boolean
}

type ReadableKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K
}[keyof T]

type ActionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never
}[keyof T]

// 工具按钮不应该访问这些内部 API
type ExcludedStateKeys = never // 没有需要排除的 state
type ExcludedActionKeys = 'toolsRegistry' | 'triggers' // 这些 API 由工具系统内部管理

type ToolStateKeys = Exclude<ReadableKeys<InputbarToolsContextValue>, ExcludedStateKeys>
type ToolActionKeys = Exclude<ActionKeys<InputbarToolsContextValue>, ExcludedActionKeys>

export type ToolStateMap = Pick<InputbarToolsContextValue, ToolStateKeys>
export type ToolActionMap = Pick<InputbarToolsContextValue, ToolActionKeys>

export type ToolStateKey = keyof ToolStateMap
export type ToolActionKey = keyof ToolActionMap

/**
 * Tool dependencies configuration
 */
export interface ToolDependencies {
  state?: ToolStateKeys[]
  actions?: ToolActionKeys[]
}

export interface ToolContext {
  scope: InputbarScope
  assistant: Assistant
  model: Model
  // Session data for Agent Session scope (only available when scope is TopicType.Session)
  session?: {
    agentId?: string
    sessionId?: string
    slashCommands?: Array<{ command: string; description?: string }>
    tools?: Array<{ id: string; name: string; type: string; description?: string }>
    accessiblePaths?: string[]
  }
}

/**
 * 工具的 QuickPanel API
 * 包含注册功能和触发功能（用于声明式 trigger handlers）
 */
export interface ToolQuickPanelApi {
  // Registration APIs (for internal use by InputbarTools)
  registerRootMenu: (entries: QuickPanelListItem[]) => () => void
  registerTrigger: (symbol: QuickPanelReservedSymbol, handler: (payload?: unknown) => void) => () => void

  // Panel control APIs (for use in trigger handlers)
  open: (options: QuickPanelOpenOptions) => void
  close: (action?: QuickPanelCloseAction, searchText?: string) => void
  updateList: (newList: QuickPanelListItem[]) => void
  updateItemSelection: (targetItem: QuickPanelListItem, isSelected: boolean) => void

  // State (read-only)
  readonly isVisible: boolean
  readonly symbol: string
}

/**
 * Tool render context with injected dependencies
 */
export type ToolRenderContext<S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]> = ToolContext & {
  state: Pick<ToolStateMap, S[number]>
  actions: Pick<ToolActionMap, A[number]>
  quickPanel: ToolQuickPanelApi
  t: TFunction
}

/**
 * QuickPanel trigger configuration for a tool.
 * Allows tools to declaratively register trigger handlers.
 */
export interface ToolQuickPanelTrigger<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  /** Trigger symbol (e.g., '@', '/', '#') */
  symbol: QuickPanelReservedSymbol

  /**
   * Factory function that creates the trigger handler.
   * Receives the tool's render context to access state/actions.
   */
  createHandler: (context: ToolRenderContext<S, A>) => (payload?: unknown) => void
}

/**
 * Root menu configuration for a tool.
 * Allows tools to contribute menu items to the '/' root menu.
 */
export interface ToolQuickPanelRootMenu<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  /**
   * Factory function that creates root menu items.
   * Receives the tool's render context to access state/actions.
   */
  createMenuItems: (context: ToolRenderContext<S, A>) => QuickPanelListItem[]
}

export interface ToolQuickPanelCapabilities<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  /** Root menu configuration (for '/' trigger) */
  rootMenu?: ToolQuickPanelRootMenu<S, A>

  /** Trigger configurations (for '@', '#', etc.) */
  triggers?: ToolQuickPanelTrigger<S, A>[]
}

/**
 * Tool definition with full type inference for dependencies
 */
export interface ToolDefinition<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  key: string
  label: string | ((t: TFunction) => string)

  // Visibility and conditions
  condition?: (context: ToolContext) => boolean
  visibleInScopes?: InputbarScope[]
  defaultHidden?: boolean

  // Dependencies
  dependencies?: {
    state?: S
    actions?: A
  }

  // Quick panel integration metadata (declarative trigger registration)
  quickPanel?: ToolQuickPanelCapabilities<S, A>

  // Render function (receives context with injected dependencies)
  // If null, the tool is a pure menu contributor (no button)
  render: ((context: ToolRenderContext<S, A>) => React.ReactNode) | null

  /**
   * Optional companion component that manages quick panel lifecycle for tools
   * that need hooks (data fetching, side effects) before registering entries.
   * It receives the same ToolRenderContext as the render function.
   */
  quickPanelManager?: React.ComponentType<{ context: ToolRenderContext<S, A> }>
}

/**
 * Helper function to define a tool with full type inference
 */
export const defineTool = <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
  tool: ToolDefinition<S, A>
): ToolDefinition<S, A> => tool

// Tool registry (use any for generics to accept all tool definitions)
const toolRegistry = new Map<string, ToolDefinition<any, any>>()

export const registerTool = (tool: ToolDefinition<any, any>): void => {
  if (toolRegistry.has(tool.key)) {
    logger.warn(`Tool with key "${tool.key}" is already registered. Overwriting.`)
  }
  toolRegistry.set(tool.key, tool)
}

export const getTool = (key: string): ToolDefinition<any, any> | undefined => {
  return toolRegistry.get(key)
}

export const getAllTools = (): ToolDefinition<any, any>[] => {
  return Array.from(toolRegistry.values())
}

export const getToolsForScope = (
  scope: InputbarScope,
  context: Omit<ToolContext, 'scope'>
): ToolDefinition<any, any>[] => {
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
  visible: InputBarToolType[]
  hidden: InputBarToolType[]
}
