import { TopicType } from '@renderer/types'

import type { ComposerToolScope, ComposerToolScopeConfig } from './types'

const DEFAULT_COMPOSER_TOOL_SCOPE: ComposerToolScope = TopicType.Chat

const composerToolConfigRegistry: Partial<Record<ComposerToolScope, ComposerToolScopeConfig>> = {
  [TopicType.Chat]: { enableQuickPanel: true, enableDragDrop: true },
  [TopicType.Session]: { enableQuickPanel: true, enableDragDrop: true },
  'quick-assistant': { enableQuickPanel: true, enableDragDrop: false }
}

export const getComposerToolConfig = (scope: ComposerToolScope): ComposerToolScopeConfig => {
  return composerToolConfigRegistry[scope] ?? composerToolConfigRegistry[DEFAULT_COMPOSER_TOOL_SCOPE]!
}
