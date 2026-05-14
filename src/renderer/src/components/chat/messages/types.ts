import type { FileMetadata, Topic, TranslateLangCode } from '@renderer/types'
import type {
  ChatMessageStyle,
  MultiModelGridPopoverTrigger,
  MultiModelMessageStyle
} from '@shared/data/preference/preferenceTypes'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageStats,
  MessageStatus,
  ModelSnapshot
} from '@shared/data/types/message'
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

export interface MessageActivityState {
  isProcessing: boolean
  isStreamTarget: boolean
  isApprovalAnchor: boolean
}

export interface MessageListItem {
  id: string
  role: CherryUIMessage['role']
  assistantId?: string
  topicId: string
  parentId?: string | null
  createdAt: string
  updatedAt?: string
  status: MessageStatus
  modelId?: string
  modelSnapshot?: ModelSnapshot
  siblingsGroupId?: number
  stats?: MessageStats
  traceId?: string | null
  mentions?: Array<{ id: string; name: string; provider: string; group?: string }>
  type?: 'clear'
}

export interface MessageRenderConfig {
  userName: string
  narrowMode: boolean
  messageStyle: ChatMessageStyle
  messageFont: string
  fontSize: number
  showMessageOutline: boolean
  multiModelMessageStyle: MultiModelMessageStyle
  multiModelGridColumns: number
  multiModelGridPopoverTrigger: MultiModelGridPopoverTrigger
}

export const defaultMessageRenderConfig: MessageRenderConfig = {
  userName: '',
  narrowMode: false,
  messageStyle: 'plain',
  messageFont: 'system',
  fontSize: 14,
  showMessageOutline: false,
  multiModelMessageStyle: 'horizontal',
  multiModelGridColumns: 2,
  multiModelGridPopoverTrigger: 'click'
}

export type MessageRenderConfigUpdate = Partial<
  Pick<MessageRenderConfig, 'multiModelGridColumns' | 'multiModelGridPopoverTrigger'>
>

export interface MessageListState {
  topic: Topic
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
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
  renderConfig: MessageRenderConfig
  selection?: MessageListSelectionState
  getMessageUiState?: (messageId: string) => MessageUiState
  getMessageSiblings?: (messageId: string) => MessageSiblingInfo | null
  getMessageActivityState?: (message: MessageListItem) => MessageActivityState
}

export interface MessageListActions {
  loadOlder?: () => void
  bindRuntime?: (runtime: MessageListRuntime) => void | (() => void)
  bindMessageRuntime?: (messageId: string, runtime: MessageRuntime) => void | (() => void)
  bindMessageGroupRuntime?: (messageIds: string[], runtime: MessageGroupRuntime) => void | (() => void)
  locateMessage?: (messageId: string, highlight?: boolean) => void
  startNewContext?: () => void
  saveCodeBlock?: (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => void | Promise<void>
  selectFiles?: (options: { extensions: string[] }) => Promise<FileMetadata[] | null | undefined>
  selectMessage?: (messageId: string, selected: boolean) => void
  toggleMultiSelectMode?: (enabled: boolean) => void
  updateMessageUiState?: (messageId: string, updates: MessageUiState) => void
  updateRenderConfig?: (updates: MessageRenderConfigUpdate) => void
  editMessage?: (messageId: string, parts: CherryMessagePart[]) => void | Promise<void>
  forkAndResendMessage?: (messageId: string, parts: CherryMessagePart[]) => void | Promise<void>
  deleteMessage?: (messageId: string, traceOptions?: { traceId?: string; modelName?: string }) => void | Promise<void>
  startMessageBranch?: (messageId: string) => void | Promise<void>
  setActiveBranch?: (messageId: string) => void | Promise<void>
  deleteMessageGroup?: (parentId: string) => void | Promise<void>
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
