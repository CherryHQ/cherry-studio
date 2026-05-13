import type { Topic, TranslateLangCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReactNode } from 'react'

export interface MessageUiState {
  foldSelected?: boolean
  multiModelMessageStyle?: string
  useful?: boolean
}

export interface MessageListSelectionState {
  enabled: boolean
  isMultiSelectMode: boolean
  selectedMessageIds?: readonly string[]
}

export interface MessageListRuntime {
  scrollToBottom: () => void
  copyTopicImage: () => Promise<void>
  exportTopicImage: () => Promise<void>
}

export interface MessageRuntime {
  locateMessage: (highlight?: boolean) => void
  startEditing: () => void
}

export interface MessageGroupRuntime {
  locateMessage: (messageId: string) => void
}

export interface MessageSiblingInfo {
  group: Array<{ id: string }>
  activeIndex: number
}

export interface MessageListState {
  topic: Topic
  messages: Message[]
  beforeList?: ReactNode
  isInitialLoading?: boolean
  hasOlder?: boolean
  messageNavigation: string
  estimateSize: number
  overscan: number
  loadOlderDelayMs: number
  loadingResetDelayMs: number
  listKey?: string
  readonly?: boolean
  selection?: MessageListSelectionState
  getMessageUiState?: (messageId: string) => MessageUiState
  getMessageSiblings?: (messageId: string) => MessageSiblingInfo | null
}

export interface MessageListActions {
  loadOlder?: () => void
  bindRuntime?: (runtime: MessageListRuntime) => void | (() => void)
  bindMessageRuntime?: (messageId: string, runtime: MessageRuntime) => void | (() => void)
  bindMessageGroupRuntime?: (messageIds: string[], runtime: MessageGroupRuntime) => void | (() => void)
  locateMessage?: (messageId: string, highlight?: boolean) => void
  startNewContext?: () => void
  saveCodeBlock?: (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => void | Promise<void>
  selectMessage?: (messageId: string, selected: boolean) => void
  toggleMultiSelectMode?: (enabled: boolean) => void
  updateMessageUiState?: (messageId: string, updates: MessageUiState) => void
  editMessage?: (messageId: string, parts: CherryMessagePart[]) => void | Promise<void>
  forkAndResendMessage?: (messageId: string, parts: CherryMessagePart[]) => void | Promise<void>
  deleteMessage?: (messageId: string, traceOptions?: { traceId?: string; modelName?: string }) => void | Promise<void>
  startMessageBranch?: (messageId: string) => void | Promise<void>
  setActiveBranch?: (messageId: string) => void | Promise<void>
  deleteMessageGroup?: (askId: string) => void | Promise<void>
  regenerateMessage?: (messageId: string) => void | Promise<void>
  regenerateMessageWithModel?: (
    messageId: string,
    modelId: UniqueModelId,
    modelSnapshot?: ModelSnapshot
  ) => void | Promise<void>
  getTranslationUpdater?: (
    messageId: string,
    targetLanguage: TranslateLangCode,
    sourceLanguage?: TranslateLangCode
  ) => Promise<((accumulatedText: string, isComplete?: boolean) => void) | null>
}

export interface MessageListMeta {
  selectionLayer: boolean
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  imageExportFileName?: string
}

export interface MessageListProviderValue {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}
