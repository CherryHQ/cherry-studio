import { TopicType } from '@renderer/types/topic'

import type { ComposerToolScope, ComposerToolScopeConfig } from './types'

const DEFAULT_COMPOSER_TOOL_SCOPE: ComposerToolScope = TopicType.Chat

const composerToolConfigRegistry: Partial<Record<ComposerToolScope, ComposerToolScopeConfig>> = {
  [TopicType.Chat]: {
    enableQuickPanel: true,
    enableDragDrop: true
  },
  [TopicType.Session]: {
    enableQuickPanel: true,
    enableDragDrop: true
  },
  'quick-assistant': {
    enableQuickPanel: true,
    enableDragDrop: false,
    inheritedToolScopes: [TopicType.Chat],
    // The chat placeholder documents three affordances and truncates in a 680px bar.
    placeholderKey: 'quickAssistant.input.placeholder.empty',
    // Inherits Chat's tools but adds screenshot and keeps its own defaults and order.
    pinnedToolsPreferenceKey: 'quick_assistant.input.toolbar.pinned_tools'
  },
  // Image-generation prompt bar: the slash quick panel surfaces only the saved
  // prompts library (the sole root-panel launcher in this scope), plus drag-drop
  // of input images (the drop layer filters by supportedExts; the edit-only
  // constraint is enforced via couldAddImageFile / switchModel, not here).
  painting: {
    enableQuickPanel: true,
    enableDragDrop: true
  }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}

export const isComposerToolVisibleInScope = (
  visibleInScopes: readonly ComposerToolScope[] | undefined,
  scope: ComposerToolScope
): boolean => {
  if (!visibleInScopes) return true

  return composerToolScopeChain(scope).some((candidate) => visibleInScopes.includes(candidate))
}

/**
 * Whether `scope` behaves as `candidate` for tool logic. A tool inherited into another
 * scope still runs with that scope's name, so an identity check against the scope it was
 * written for silently disables its behavior — ask this instead.
 */
export const resolvesToolScopeAs = (scope: ComposerToolScope, candidate: ComposerToolScope): boolean =>
  composerToolScopeChain(scope).includes(candidate)

const composerToolScopeChain = (scope: ComposerToolScope): readonly ComposerToolScope[] => [
  scope,
  ...(getComposerToolConfig(scope).inheritedToolScopes ?? [])
]
