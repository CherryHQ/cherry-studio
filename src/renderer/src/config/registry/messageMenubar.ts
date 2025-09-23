import { TopicType } from '@renderer/types'

export type MessageMenubarScope = TopicType

export type MessageMenubarButtonId =
  | 'user-regenerate'
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

export type MessageMenubarScopeConfig = {
  buttonIds: MessageMenubarButtonId[]
  dropdownRootAllowKeys?: string[]
}

export const DEFAULT_MESSAGE_MENUBAR_SCOPE: MessageMenubarScope = TopicType.Chat

export const DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS: MessageMenubarButtonId[] = [
  'user-regenerate',
  'user-edit',
  'copy',
  'assistant-regenerate',
  'assistant-mention-model',
  'translate',
  'useful',
  'notes',
  'delete',
  'trace',
  'more-menu'
]

export const SESSION_MESSAGE_MENUBAR_BUTTON_IDS: MessageMenubarButtonId[] = [
  'copy',
  'translate',
  'notes',
  'delete',
  'more-menu'
]

const messageMenubarRegistry = new Map<MessageMenubarScope, MessageMenubarScopeConfig>([
  [DEFAULT_MESSAGE_MENUBAR_SCOPE, { buttonIds: [...DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS] }],
  [TopicType.Chat, { buttonIds: [...DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS] }],
  [TopicType.Session, { buttonIds: [...SESSION_MESSAGE_MENUBAR_BUTTON_IDS], dropdownRootAllowKeys: ['save', 'export'] }]
])

export const registerMessageMenubarConfig = (scope: MessageMenubarScope, config: MessageMenubarScopeConfig) => {
  const clonedConfig: MessageMenubarScopeConfig = {
    buttonIds: [...config.buttonIds],
    dropdownRootAllowKeys: config.dropdownRootAllowKeys ? [...config.dropdownRootAllowKeys] : undefined
  }
  messageMenubarRegistry.set(scope, clonedConfig)
}

export const getMessageMenubarConfig = (scope: MessageMenubarScope): MessageMenubarScopeConfig => {
  if (messageMenubarRegistry.has(scope)) {
    return messageMenubarRegistry.get(scope) as MessageMenubarScopeConfig
  }
  return messageMenubarRegistry.get(DEFAULT_MESSAGE_MENUBAR_SCOPE) as MessageMenubarScopeConfig
}
