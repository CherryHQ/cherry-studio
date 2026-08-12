export type MessageMenuBarButtonId =
  | 'user-edit'
  | 'copy'
  | 'assistant-regenerate'
  | 'assistant-mention-model'
  | 'translate'
  | 'useful'
  | 'notes'
  | 'delete'
  | 'more-menu'

export const DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS: MessageMenuBarButtonId[] = [
  'copy',
  'user-edit',
  'assistant-regenerate',
  'assistant-mention-model',
  'translate',
  'useful',
  'notes',
  'delete',
  'more-menu'
]

export const STREAMING_DISABLED_BUTTON_IDS: ReadonlySet<MessageMenuBarButtonId> = new Set([
  'user-edit',
  'delete',
  'assistant-regenerate'
])
