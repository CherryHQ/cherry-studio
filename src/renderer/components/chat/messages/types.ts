import type { DeleteMessageOptions, MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import type { SerializedError } from '@renderer/types/error'
import type { FileMetadata } from '@renderer/types/file'
import type { Citation, MessageUiState } from '@renderer/types/message'
import type { MessageExportView } from '@renderer/types/messageExport'
import type { McpTool } from '@renderer/types/tool'
import type { Topic } from '@renderer/types/topic'
import type { AgentSessionDelivery } from '@shared/ai/agentSessionDelivery'
import type {
  ChatMessageStyle,
  MultiModelGridPopoverTrigger,
  MultiModelMessageStyle,
  TranslateLangCode
} from '@shared/data/preference/preferenceTypes'
import type { AiUsageRecordMessageKind } from '@shared/data/types/aiUsageRecord'
import type { FileHandle } from '@shared/data/types/file'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageSnapshot,
  MessageStats,
  MessageStatus,
  ModelSnapshot
} from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import type { FileUrlString } from '@shared/types/file'
import type { ReactNode } from 'react'

export type { MessageUiState } from '@renderer/types/message'

export interface MessageListSelectionState {
  enabled: boolean
  isMultiSelectMode: boolean
  selectedMessageIds?: readonly string[]
}

export interface MessageListRuntime {
  scrollToBottom: () => void
  locateMessage: (messageId: string) => void
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

export interface MessageActivityStore {
  getSnapshot: (message: MessageListItem) => MessageActivityState
  subscribe: (messageId: string, listener: () => void) => () => void
}

export interface MessageFileView {
  displayName: string
  previewUrl?: FileUrlString
}

/**
 * A message attachment the user can open or preview.
 *
 * Carries a `FileHandle` rather than a path: Main owns path resolution, so no
 * renderer surface reconstructs one from the part's `file://` URL.
 */
export interface MessageAttachmentTarget {
  handle: FileHandle
  name: string
  ext: string
}

export interface MessageMenuExportOptions {
  image: boolean
  markdown: boolean
  markdown_reason: boolean
  notion: boolean
  yuque: boolean
  joplin: boolean
  obsidian: boolean
  siyuan: boolean
  docx: boolean
  plain_text: boolean
}

export interface MessageMenuConfig {
  confirmDeleteMessage: boolean
  enableDeveloperMode: boolean
  exportMenuOptions: MessageMenuExportOptions
}

export const defaultMessageMenuExportOptions: MessageMenuExportOptions = {
  image: false,
  markdown: false,
  markdown_reason: false,
  notion: false,
  yuque: false,
  joplin: false,
  obsidian: false,
  siyuan: false,
  docx: false,
  plain_text: false
}

export const defaultMessageMenuConfig: MessageMenuConfig = {
  confirmDeleteMessage: false,
  enableDeveloperMode: false,
  exportMenuOptions: defaultMessageMenuExportOptions
}

export interface MessageModelPickerRenderOptions {
  message: MessageListItem
  messageParts: CherryMessagePart[]
  trigger: ReactNode
  onOpenChange?: (open: boolean) => void
}

export interface MessageErrorDiagnosisStep {
  text: string
}

export interface MessageErrorDiagnosisResult {
  summary: string
  category: string
  explanation: string
  steps: MessageErrorDiagnosisStep[]
}

export interface MessageErrorDiagnosisContext {
  errorSource?: string
  providerName?: string
  modelId?: string
}

export interface MessageErrorDiagnosisInput {
  message: MessageListItem
  partId: string
  error: SerializedError
  language: string
}

export interface MessageUserProfile {
  name?: string
  avatar?: string
}

export interface MessageToolApprovalMatch {
  part: CherryMessagePart
  state: string
  toolCallId: string
  messageId: string
  approvalId: string
  input?: unknown
}

export interface MessageToolApprovalInput {
  match: MessageToolApprovalMatch
  approved: boolean
  reason?: string
  updatedInput?: Record<string, unknown>
}

export interface MessageErrorDetailInput {
  message: MessageListItem
  partId: string
  error?: SerializedError
  cachedDiagnosis?: MessageErrorDiagnosisResult
  diagnosisContext?: MessageErrorDiagnosisContext
}

export interface OpenAgentToolFlowInput {
  toolCallId: string
  toolName?: string
  title?: string
}

export interface RemoveMessageErrorPartInput {
  messageId: string
  partId: string
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
  /** Persisted row identity before any snapshot fallback is projected. */
  persistedModelId?: string | null
  /** Resolved model identity (from the author snapshot or the topic fallback). */
  model?: ModelSnapshot
  /** Producing-author snapshot (assistant|agent, model nested) frozen at creation. */
  messageSnapshot?: MessageSnapshot
  siblingsGroupId?: number
  isActiveBranch?: boolean
  stats?: MessageStats
  delivery?: AgentSessionDelivery
  mentions?: Array<{
    id: string
    name: string
    provider: string
    group?: string
  }>
  /** Derived from the message's hidden `data-clear` part. */
  isContextBoundary?: boolean
}

/**
 * The message topology the anchor rail derives its turns from — deliberately
 * the complete set of fields it may read.
 *
 * Streaming rewrites message content and array identity on every chunk but
 * never the topology, so projecting onto these fields lets the rail keep a
 * referentially stable `messages` prop and skip the render entirely. Reading
 * any other field from the rail means widening this type first, which is a
 * compile error rather than a silently stale render.
 */
export interface AnchorMessage {
  id: string
  role: MessageListItem['role']
  isActiveBranch?: boolean
  isContextBoundary?: boolean
}

export interface MessageRenderConfig {
  userName: string
  narrowMode: boolean
  messageStyle: ChatMessageStyle
  messageFont: string
  fontSize: number
  renderInputMessageAsMarkdown: boolean
  codeFancyBlock: boolean
  thoughtAutoCollapse: boolean
  collapseCompletedToolHistory: boolean
  mathEnableSingleDollar: boolean
  showMessageOutline: boolean
  showEstimatedTokens: boolean
  multiModelMessageStyle: MultiModelMessageStyle
  multiModelGridColumns: number
  multiModelGridPopoverTrigger: MultiModelGridPopoverTrigger
}

export const defaultMessageRenderConfig: MessageRenderConfig = {
  userName: '',
  narrowMode: false,
  messageStyle: 'bubble',
  messageFont: 'system',
  fontSize: 14,
  renderInputMessageAsMarkdown: false,
  codeFancyBlock: true,
  thoughtAutoCollapse: true,
  collapseCompletedToolHistory: true,
  mathEnableSingleDollar: false,
  showMessageOutline: false,
  showEstimatedTokens: false,
  multiModelMessageStyle: 'horizontal',
  multiModelGridColumns: 2,
  multiModelGridPopoverTrigger: 'click'
}

export type MessageRenderConfigUpdate = Partial<
  Pick<MessageRenderConfig, 'multiModelGridColumns' | 'multiModelGridPopoverTrigger'>
>

/**
 * Layered streaming state. `historyPartsByMessageId` holds the persisted
 * parts used by the sealed history render layer (it never sees per-frame
 * stream snapshots); `liveMessageIds` marks the mutable streaming tail.
 */
export interface MessageStreamingLayers {
  historyPartsByMessageId: Record<string, CherryMessagePart[]>
  liveMessageIds: readonly string[]
}

export interface MessageTailSlot {
  messageId: string
  content: ReactNode
}

export interface MessageListState {
  topic: Topic
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  /** When provided, streaming updates stay isolated from historical message subtrees. */
  streamingLayers?: MessageStreamingLayers
  beforeList?: ReactNode
  /** Optional adapter-owned content rendered after one message's body. */
  messageTail?: MessageTailSlot
  /** Renders the live turn's processing status inline, replacing the default placeholder. Receives
   *  that placeholder as a fallback, so an override (e.g. an ephemeral agent api-retry line) can take
   *  over while active and fall back to the placeholder otherwise. Called only in the message that owns
   *  the live turn. */
  activeTurnStatus?: (placeholder: ReactNode) => ReactNode
  isInitialLoading?: boolean
  isMessagesStale?: boolean
  hasOlder?: boolean
  messageNavigation: string
  estimateSize: number
  overscan: number
  loadOlderDelayMs: number
  loadingResetDelayMs: number
  listKey?: string
  renderConfig: MessageRenderConfig
  menuConfig?: MessageMenuConfig
  selection?: MessageListSelectionState
  editingMessageId?: string | null
  translationLanguages?: TranslateLanguage[]
  translationLanguagesStatus?: 'loading' | 'error' | 'ready'
  getMessageUiState?: (messageId: string) => MessageUiState
  getMessageSiblings?: (messageId: string) => MessageSiblingInfo | null
  messageActivityStore?: MessageActivityStore
  getMessageActivityState?: (message: MessageListItem) => MessageActivityState
  isMessageTranslating?: (messageId: string) => boolean
  getFileView?: (file: Pick<FileMetadata, 'origin_name' | 'ext' | 'created_at'>) => MessageFileView
  isToolAutoApproved?: (tool: McpTool, allowedTools?: string[]) => boolean
  getTranslationLanguageLabel?: (
    language: TranslateLangCode | TranslateLanguage | null,
    withEmoji?: boolean
  ) => string | undefined
}

/** Shared list mechanics; page adapters provide data and capabilities, not separate geometry or loading timing. */
export const DEFAULT_MESSAGE_LIST_CONFIG = {
  estimateSize: 400,
  overscan: 6,
  loadOlderDelayMs: 0,
  loadingResetDelayMs: 600
} as const satisfies Pick<MessageListState, 'estimateSize' | 'overscan' | 'loadOlderDelayMs' | 'loadingResetDelayMs'>

export interface MessageListActions {
  loadOlder?: () => void
  bindRuntime?: (runtime: MessageListRuntime) => void | (() => void)
  bindMessageRuntime?: (messageId: string, runtime: MessageRuntime) => void | (() => void)
  bindMessageGroupRuntime?: (messageIds: string[], runtime: MessageGroupRuntime) => void | (() => void)
  locateMessage?: (messageId: string, highlight?: boolean) => void
  startNewContext?: () => void
  saveCodeBlock?: (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => void | Promise<void>
  saveTextFile?: (fileName: string, content: string) => string | null | void | Promise<string | null | void>
  saveImage?: (fileName: string, dataUrl: string) => boolean | Promise<boolean>
  saveToKnowledge?: (message: MessageExportView) => void | Promise<void>
  exportMessageAsMarkdown?: (message: MessageExportView, includeReasoning?: boolean) => void | Promise<void>
  exportToNotes?: (message: MessageExportView) => void | Promise<void>
  exportToWord?: (markdown: string, title: string) => void | Promise<void>
  exportToNotion?: (message: MessageExportView) => void | Promise<void>
  exportToYuque?: (message: MessageExportView) => void | Promise<void>
  exportToObsidian?: (message: MessageExportView) => void | Promise<void>
  exportToJoplin?: (message: MessageExportView) => void | Promise<void>
  exportToSiyuan?: (message: MessageExportView) => void | Promise<void>
  openArtifactFile?: (path: string) => void | Promise<void>
  openDiagnosticReport?: (description?: string) => void
  resolvePath?: (path: string) => string
  openFile?: (target: MessageAttachmentTarget) => void | Promise<void>
  openPath?: (path: string) => void | Promise<void>
  openCitationsPanel?: (data: { citations: Citation[] }) => void
  openAgentToolFlow?: (input: OpenAgentToolFlowInput) => void
  openExternalUrl?: (url: string) => void | Promise<void>
  navigateToRoute?: (target: { path: string; query?: Record<string, string> }) => void | Promise<void>
  openUserProfile?: () => void | Promise<void>
  copyText?: (text: string, options?: { successMessage?: string; emptyMessage?: string }) => void | Promise<void>
  copyRichContent?: (
    content: { plainText: string; html: string; customFormats?: Record<string, string> },
    options?: { successMessage?: string }
  ) => void | Promise<void>
  copyImage?: (blob: Blob, options?: { successMessage?: string }) => void | Promise<void>
  exportTableAsExcel?: (data: string[][]) => boolean | Promise<boolean>
  notifyInfo?: (message: string) => void
  notifySuccess?: (message: string) => void
  notifyWarning?: (message: string) => void
  notifyError?: (message: string) => void
  previewFile?: (target: MessageAttachmentTarget) => void | Promise<void>
  abortTool?: (toolId: string) => boolean | Promise<boolean>
  subscribeToolProgress?: (toolId: string, onProgress: (progress: number) => void) => void | (() => void)
  respondToolApproval?: (input: MessageToolApprovalInput) => void | Promise<void>
  diagnoseMessageError?: (
    input: MessageErrorDiagnosisInput
  ) => Promise<MessageErrorDiagnosisResult | string | null | undefined>
  removeMessageErrorPart?: (input: RemoveMessageErrorPartInput) => void | Promise<void>
  openErrorDetail?: (input: MessageErrorDetailInput) => void | Promise<void>
  navigateErrorTarget?: (target: string) => void | Promise<void>
  requestTranslationLanguages?: () => void
  retryTranslationLanguages?: () => void
  translateMessage?: (messageId: string, language: TranslateLanguage, sourceText: string) => void | Promise<void>
  abortMessageTranslation?: (messageId: string) => void | Promise<void>
  removeMessageTranslation?: (messageId: string) => void | Promise<void>
  renderRegenerateModelPicker?: (options: MessageModelPickerRenderOptions) => ReactNode
  selectMessage?: (messageId: string, selected: boolean) => void
  toggleMultiSelectMode?: (enabled: boolean) => void
  copySelectedMessages?: (messageIds?: readonly string[]) => void | Promise<void>
  saveSelectedMessages?: (messageIds?: readonly string[]) => void | Promise<void>
  deleteSelectedMessages?: (messageIds?: readonly string[]) => void | Promise<void>
  updateMessageUiState?: (messageId: string, updates: MessageUiState) => void
  updateRenderConfig?: (updates: MessageRenderConfigUpdate) => void
  editMessage?: (messageId: string, parts: CherryMessagePart[]) => void | Promise<void>
  /** Open the inline editor for a message. Absent = editing unavailable (read-only embeds). */
  startEditing?: (
    message: MessageListItem,
    parts: CherryMessagePart[],
    options?: { lockedMentionedModels?: Model[] }
  ) => void
  getMessageDeleteAvailability?: (messageId: string) => MessageDeleteAvailability
  deleteMessage?: (messageId: string, options?: DeleteMessageOptions) => void | Promise<void>
  startMessageBranch?: (messageId: string) => void | Promise<void>
  copyBranchToNewTopic?: (messageId: string) => void | Promise<void>
  setActiveBranch?: (messageId: string) => void | Promise<void>
  deleteMessageGroup?: (messageIds: readonly string[]) => void | Promise<void>
  deleteMessageGroupWithConfirm?: (messageIds: readonly string[]) => void | Promise<void>
  regenerateMessage?: (messageId: string) => void | Promise<void>
}

export interface MessageListMeta {
  selectionLayer: boolean
  userProfile?: MessageUserProfile
  assistantProfile?: MessageUserProfile
  imageExportFileName?: string
  /** Usage-record partition this surface's messages belong to. Defaults to 'chat'. */
  aiUsageMessageKind?: AiUsageRecordMessageKind
}

export interface MessageListProviderValue {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}
