import { TopicType } from '@renderer/types'

import type { ComposerToolScope, ComposerToolScopeConfig } from './types'

const DEFAULT_COMPOSER_TOOL_SCOPE: ComposerToolScope = TopicType.Chat

const composerToolConfigRegistry = new Map<ComposerToolScope, ComposerToolScopeConfig>([
  [
    TopicType.Chat,
    {
      minRows: 1,
      maxRows: 8,
      showTokenCount: true,
      showTools: true,
      toolsCollapsible: true,
      enableQuickPanel: true,
      enableDragDrop: true
    }
  ],
  [
    TopicType.Session,
    {
      placeholder: 'Type a message...',
      minRows: 2,
      maxRows: 20,
      showTokenCount: false,
      showTools: true,
      toolsCollapsible: false,
      enableQuickPanel: true,
      enableDragDrop: true
    }
  ],
  [
    'quick-assistant',
    {
      minRows: 1,
      maxRows: 3,
      showTokenCount: false,
      showTools: true,
      toolsCollapsible: false,
      enableQuickPanel: true,
      enableDragDrop: false
    }
  ]
])

export const registerComposerToolConfig = (scope: ComposerToolScope, config: ComposerToolScopeConfig): void => {
  composerToolConfigRegistry.set(scope, config)
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry.get(scope) || composerToolConfigRegistry.get(DEFAULT_COMPOSER_TOOL_SCOPE)!
}
