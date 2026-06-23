import { TopicType } from '@renderer/types'

import type { ComposerToolScope, ComposerToolScopeConfig } from './types'

const DEFAULT_COMPOSER_TOOL_SCOPE: ComposerToolScope = TopicType.Chat

const composerToolConfigRegistry: Partial<Record<ComposerToolScope, ComposerToolScopeConfig>> = {
  [TopicType.Chat]: {
    minRows: 1,
    maxRows: 8,
    showTokenCount: true,
    showTools: true,
    toolsCollapsible: true,
    enableQuickPanel: true,
    enableDragDrop: true
  },
  [TopicType.Session]: {
    minRows: 2,
    maxRows: 20,
    showTokenCount: false,
    showTools: true,
    toolsCollapsible: false,
    enableQuickPanel: true,
    enableDragDrop: true
  },
  'quick-assistant': {
    minRows: 1,
    maxRows: 3,
    showTokenCount: false,
    showTools: true,
    toolsCollapsible: false,
    enableQuickPanel: true,
    enableDragDrop: false
  }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}
