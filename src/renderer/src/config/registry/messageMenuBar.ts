import { TopicType } from '@renderer/types'

export type MessageMenuBarScope = TopicType

export type MessageMenuBarButtonId =
  | 'user-edit'
  | 'copy'
  | 'assistant-regenerate'
  | 'assistant-mention-model'
  | 'translate'
  | 'useful'
  | 'notes'
  | 'delete'
  | 'trace'
  | 'more-menu'
  // dev only
  | 'inspect-data'

export type MessageMenuBarScopeConfig = {
  buttonIds: MessageMenuBarButtonId[]
  dropdownRootAllowKeys?: string[]
}

export const DEFAULT_MESSAGE_MENUBAR_SCOPE: MessageMenuBarScope = TopicType.Chat

export const DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS: MessageMenuBarButtonId[] = [
  'user-edit',
  'copy',
  'assistant-regenerate',
  'assistant-mention-model',
  'translate',
  'useful',
  'notes',
  'delete',
  'trace',
  'inspect-data',
  'more-menu'
]

export const SESSION_MESSAGE_MENUBAR_BUTTON_IDS: MessageMenuBarButtonId[] = [
  'copy',
  'translate',
  'notes',
  'delete',
  'more-menu'
]

export const STREAMING_DISABLED_BUTTON_IDS: ReadonlySet<MessageMenuBarButtonId> = new Set([
  'user-edit',
  'delete',
  'assistant-regenerate'
])

const messageMenuBarRegistry = new Map<MessageMenuBarScope, MessageMenuBarScopeConfig>([
  [DEFAULT_MESSAGE_MENUBAR_SCOPE, { buttonIds: [...DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS] }],
  [TopicType.Chat, { buttonIds: [...DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS] }],
  [TopicType.Session, { buttonIds: [...SESSION_MESSAGE_MENUBAR_BUTTON_IDS], dropdownRootAllowKeys: ['save', 'export'] }]
])

export const registerMessageMenuBarConfig = (scope: MessageMenuBarScope, config: MessageMenuBarScopeConfig) => {
  const clonedConfig: MessageMenuBarScopeConfig = {
    buttonIds: [...config.buttonIds],
    dropdownRootAllowKeys: config.dropdownRootAllowKeys ? [...config.dropdownRootAllowKeys] : undefined
  }
  messageMenuBarRegistry.set(scope, clonedConfig)
}

export const getMessageMenuBarConfig = (scope: MessageMenuBarScope): MessageMenuBarScopeConfig => {
  if (messageMenuBarRegistry.has(scope)) {
    return messageMenuBarRegistry.get(scope) as MessageMenuBarScopeConfig
  }
  return messageMenuBarRegistry.get(DEFAULT_MESSAGE_MENUBAR_SCOPE) as MessageMenuBarScopeConfig
}
