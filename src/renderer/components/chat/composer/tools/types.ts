import { loggerService } from '@logger'
import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import { type Assistant, type ThinkingOption, TopicType } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { TFunction } from 'i18next'
import React from 'react'

import type { ComposerSerializedToken } from '../tokens'
import type { ComposerToolContextValue } from './ComposerToolProvider'

export { TopicType }

const logger = loggerService.withContext('ComposerToolRegistry')

export type ComposerToolScope = TopicType | 'quick-assistant'

export interface ComposerToolScopeConfig {
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
type ExcludedStateKeys = 'isExpanded'
type ExcludedActionKeys = 'setIsExpanded' | 'toolsRegistry' | 'triggers' // 这些 API 由工具系统内部管理

type ToolStateKeys = Exclude<ReadableKeys<ComposerToolContextValue>, ExcludedStateKeys>
type ToolActionKeys = Exclude<ActionKeys<ComposerToolContextValue>, ExcludedActionKeys>

export type ToolStateMap = Pick<ComposerToolContextValue, ToolStateKeys>
export type ToolActionMap = Pick<ComposerToolContextValue, ToolActionKeys>

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
  scope: ComposerToolScope
  /** Absent in Agent Session scope — Sessions have an `agentId` (see `session`), not an assistant row. */
  assistant?: Assistant
  model: Model
  // Resolved v2 provider for `model.providerId`. Injected by the React
  // dispatch site (ComposerToolRuntimeHost) so sync `condition()` predicates can run
  // v2 provider checks without a v1 Redux lookup. Undefined while loading
  // or when the provider is unknown.
  provider?: Provider
  // Session data for Agent Session scope (only available when scope is TopicType.Session).
  // Note: config fields (model/instructions/...) live on the parent agent — fetch via
  // useAgent(session.agentId). agentType drives builtin slash command lookup.
  session?: {
    agentId?: string
    sessionId?: string
    agentType?: string
    tools?: Array<{ id: string; name: string; type: string; description?: string }>
    accessiblePaths?: string[]
    reasoningEffort?: ThinkingOption
    onReasoningEffortChange?: (option: ThinkingOption) => void
  }
}

export interface ToolLauncherApi {
  registerLaunchers: (entries: ComposerToolLauncher[]) => () => void
}

/**
 * Tool render context with injected dependencies
 */
export type ToolRenderContext<S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]> = ToolContext & {
  state: Pick<ToolStateMap, S[number]>
  actions: Pick<ToolActionMap, A[number]>
  launcher: ToolLauncherApi
  t: TFunction
}

export interface ToolComposerMenuContribution<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  createItems: (context: ToolRenderContext<S, A>) => ComposerToolLauncher[]
}

export interface ToolTokenContribution<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  /**
   * Reconcile composer state when the editor's managed tokens change. Each tool prunes/re-adds
   * ONLY its own token kind (file/knowledge/skill) via `context.actions`, using functional
   * `setState` updates so it is safe to call from an event handler.
   */
  reconcile: (draftTokens: readonly ComposerSerializedToken[], context: ToolRenderContext<S, A>) => void
}

export interface ToolComposerContribution<
  S extends readonly ToolStateKey[] = readonly ToolStateKey[],
  A extends readonly ToolActionKey[] = readonly ToolActionKey[]
> {
  // Composer-native "+" popover and "/" root suggestion entries.
  menuItems?: ToolComposerMenuContribution<S, A>

  /**
   * Composer-only runtime contribution for tools that need hooks or side effects
   * to register menu items, pickers, or active controls.
   */
  runtime?: React.ComponentType<{ context: ToolRenderContext<S, A> }>

  /** Editor→state token reconciliation owned by this tool (see `useComposerTokenReconcile`). */
  tokens?: ToolTokenContribution<S, A>
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
  visibleInScopes?: ComposerToolScope[]
  defaultHidden?: boolean

  // Dependencies
  dependencies?: {
    state?: S
    actions?: A
  }

  // Composer-native contributions.
  composer?: ToolComposerContribution<S, A>
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
  scope: ComposerToolScope,
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
