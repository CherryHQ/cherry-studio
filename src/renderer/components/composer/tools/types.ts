import { pick } from 'es-toolkit'
import type { TFunction } from 'i18next'
import React from 'react'

import type {
  ComposerToolFooterAction,
  ComposerToolLauncher,
  ComposerToolLauncherKind
} from '@renderer/components/composer/toolLauncher'
import type { Assistant } from '@renderer/types/assistant'
import { TopicType } from '@renderer/types/topic'
import type { SlashCommand } from '@shared/ai/slashCommands'
import type { Model } from '@shared/data/types/model'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { ComposerSerializedToken } from '../tokens'
import type { ComposerToolDispatch, ComposerToolState } from './ComposerToolProvider'

export { TopicType }

export type ComposerToolScope = TopicType | 'quick-assistant' | 'painting'

export interface ComposerToolScopeConfig {
  enableQuickPanel?: boolean
  enableDragDrop?: boolean
}

export type ToolStateMap = Omit<ComposerToolState, 'isExpanded'>

export type ToolActionMap = Omit<ComposerToolDispatch, 'setIsExpanded' | 'toolsRegistry' | 'triggers'>

export type ToolStateKey = keyof ToolStateMap

export type ToolActionKey = keyof ToolActionMap

/**
 * Tool dependencies configuration
 */
export interface ToolDependencies {
  readonly state?: readonly ToolStateKey[]
  readonly actions?: readonly ToolActionKey[]
}

export interface ToolContext {
  scope: ComposerToolScope
  /** Absent in Agent Session scope — Sessions have an `agentId` (see `session`), not an assistant row. */
  assistant?: Assistant
  model?: Model
  // Session data for Agent Session scope (only available when scope is TopicType.Session).
  // Note: config fields (model/instructions/...) live on the parent agent — fetch via
  // useAgent(session.agentId). agentType drives the builtin slash command fallback; slashCommands
  // carries the live SDK catalog (custom commands included) when the runtime has reported it.
  session?: {
    agentId?: string
    sessionId?: string
    agentType?: string
    tools?: Array<{ id: string; name: string; type: string; description?: string }>
    accessiblePaths?: readonly AbsoluteFilePath[]
    slashCommands?: (SlashCommand & { builtin?: boolean })[]
    /** Knowledge bases statically bound to the Agent. */
    knowledgeBaseIds?: readonly string[]
  }
}

export interface ToolLauncherApi {
  registerLaunchers: (entries: ComposerToolLauncher[], footerActions?: ComposerToolFooterAction[]) => () => void
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
  S extends readonly ToolStateKey[] = readonly [],
  A extends readonly ToolActionKey[] = readonly []
> {
  createItems: (context: ToolRenderContext<S, A>) => ComposerToolLauncher[]
}

/**
 * Stable toolbar identity for a pinnable tool. Runtime launchers overlay model-
 * and state-dependent behavior after they register.
 */
export interface ToolComposerToolbarContribution {
  id: string
  kind: ComposerToolLauncherKind
  order: number
  icon: React.ReactNode
  /** Lets a resolved tool bypass the composer's chat-model-required guard. */
  availableWithoutModel?: boolean
}

export interface ToolTokenContribution<
  S extends readonly ToolStateKey[] = readonly [],
  A extends readonly ToolActionKey[] = readonly []
> {
  /**
   * Reconcile composer state when the editor's managed tokens change. Each tool prunes/re-adds
   * ONLY its own token kind (file/knowledge) via `context.actions`, using functional
   * `setState` updates so it is safe to call from an event handler.
   */
  reconcile: (draftTokens: readonly ComposerSerializedToken[], context: ToolRenderContext<S, A>) => void
}

export interface ToolComposerContribution<
  S extends readonly ToolStateKey[] = readonly [],
  A extends readonly ToolActionKey[] = readonly []
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

interface ToolMetadata {
  key: string
  label: string | ((t: TFunction) => string)

  // Visibility and conditions
  condition?: (context: ToolContext) => boolean
  visibleInScopes?: ComposerToolScope[]
  defaultHidden?: boolean
  availableWithoutModel?: boolean
}

/** Tool definition with dependency tuples shared by all contributions. */
export type ToolDefinition<
  S extends readonly ToolStateKey[] = readonly [],
  A extends readonly ToolActionKey[] = readonly []
> = ToolMetadata & {
  dependencies?: { state?: S; actions?: A }
  composer?: ToolComposerContribution<S, A>
} & (S extends readonly [] ? unknown : { dependencies: { state: S } }) &
  (A extends readonly [] ? unknown : { dependencies: { actions: A } })

export interface ToolContextSource extends ToolContext {
  state: ToolStateMap
  actions: ToolActionMap
  launcher: ToolLauncherApi
  t: TFunction
}

interface PreparedToolRuntime {
  render?: () => React.ReactNode
  createItems?: () => ComposerToolLauncher[]
}

export interface ComposerToolRegistration extends ToolMetadata {
  dependencies?: ToolDependencies
  prepareRuntime: (source: ToolContextSource) => PreparedToolRuntime
  reconcileTokens?: (tokens: readonly ComposerSerializedToken[], source: ToolContextSource) => void
}

const EMPTY_KEYS: readonly [] = []

function buildToolContext<S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
  source: ToolContextSource,
  stateKeys: S,
  actionKeys: A
): ToolRenderContext<S, A> {
  return {
    scope: source.scope,
    assistant: source.assistant,
    model: source.model,
    session: source.session,
    state: pick(source.state, stateKeys),
    actions: pick(source.actions, actionKeys),
    launcher: source.launcher,
    t: source.t
  }
}

export const defineTool = <
  const S extends readonly ToolStateKey[] = readonly [],
  const A extends readonly ToolActionKey[] = readonly []
>(
  tool: ToolDefinition<S, A>
): ToolDefinition<S, A> & ComposerToolRegistration => {
  const bridge = {
    prepareRuntime(source: ToolContextSource): PreparedToolRuntime {
      const context = buildToolContext(
        source,
        tool.dependencies?.state ?? EMPTY_KEYS,
        tool.dependencies?.actions ?? EMPTY_KEYS
      )
      const prepared: PreparedToolRuntime = {}
      const menu = tool.composer?.menuItems
      const Runtime = tool.composer?.runtime

      if (menu) prepared.createItems = () => menu.createItems(context)
      if (Runtime) prepared.render = () => React.createElement(Runtime, { context })

      return prepared
    }
  }
  const tokens = tool.composer?.tokens

  if (tokens) {
    return Object.assign(tool, bridge, {
      reconcileTokens(draft: readonly ComposerSerializedToken[], source: ToolContextSource) {
        tokens.reconcile(
          draft,
          buildToolContext(source, tool.dependencies?.state ?? EMPTY_KEYS, tool.dependencies?.actions ?? EMPTY_KEYS)
        )
      }
    })
  }

  return Object.assign(tool, bridge)
}
