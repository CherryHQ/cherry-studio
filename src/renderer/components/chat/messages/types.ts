import type { Citation, FileMetadata, McpTool, Topic, TranslateLangCode, TranslateLanguage } from '@renderer/types'
import type { SerializedError } from '@renderer/types/error'
import type { MessageExportView } from '@renderer/types/messageExport'
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
import type { Model } from '@shared/data/types/model'
import type { ExternalAppInfo } from '@shared/types/externalApp'
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

export interface MessageFileView {
  displayName: string
  safePath?: string
  previewUrl?: string
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
  sourceMessageId?: string
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
  modelSnapshot?: ModelSnapshot
  siblingsGroupId?: number
  isActiveBranch?: boolean
  stats?: MessageStats
  mentions?: Array<{
    id: string
    name: string
    provider: string
    group?: string
  }>
  type?: 'clear'
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
  menuConfig?: MessageMenuConfig
  selection?: MessageListSelectionState
  editingMessageId?: string | null
  translationLanguages?: TranslateLanguage[]
  getMessageUiState?: (messageId: string) => MessageUiState
  getMessageSiblings?: (messageId: string) => MessageSiblingInfo | null
  getMessageActivityState?: (message: MessageListItem) => MessageActivityState
  getFileView?: (file: FileMetadata) => MessageFileView
  isToolAutoApproved?: (tool: McpTool, allowedTools?: string[]) => boolean
  externalCodeEditors?: ExternalAppInfo[]
  getTranslationLanguageLabel?: (
    language: TranslateLangCode | TranslateLanguage | null,
    withEmoji?: boolean
  ) => string | undefined
}

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
  openPath?: (path: string) => void | Promise<void>
  openCitationsPanel?: (data: { citations: Citation[] }) => void
  openAgentToolFlow?: (input: OpenAgentToolFlowInput) => void
  showInFolder?: (path: string) => void | Promise<void>
  openExternalUrl?: (url: string) => void | Promise<void>
  openInExternalApp?: (app: ExternalAppInfo, path: string) => void | Promise<void>
  navigateToRoute?: (target: { path: string; query?: Record<string, string> }) => void | Promise<void>
  openUserProfile?: () => void | Promise<void>
  copyText?: (text: string, options?: { successMessage?: string; emptyMessage?: string }) => void | Promise<void>
  copyRichContent?: (
    content: { plainText: string; html: string; customFormats?: Record<string, string> },
    options?: { successMessage?: string }
  ) => void | Promise<void>
  copyImage?: (blob: Blob, options?: { successMessage?: string }) => void | Promise<void>
  exportTableAsExcel?: (markdown: string) => boolean | Promise<boolean>
  notifyInfo?: (message: string) => void
  notifySuccess?: (message: string) => void
  notifyWarning?: (message: string) => void
  notifyError?: (message: string) => void
  previewFile?: (file: FileMetadata) => void | Promise<void>
  abortTool?: (toolId: string) => boolean | Promise<boolean>
  subscribeToolProgress?: (toolId: string, onProgress: (progress: number) => void) => void | (() => void)
  respondToolApproval?: (input: MessageToolApprovalInput) => void | Promise<void>
  diagnoseMessageError?: (
    input: MessageErrorDiagnosisInput
  ) => Promise<MessageErrorDiagnosisResult | string | null | undefined>
  removeMessageErrorPart?: (input: RemoveMessageErrorPartInput) => void | Promise<void>
  openErrorDetail?: (input: MessageErrorDetailInput) => void | Promise<void>
  navigateErrorTarget?: (target: string) => void | Promise<void>
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
  deleteMessage?: (messageId: string, traceOptions?: { modelName?: string }) => void | Promise<void>
  startMessageBranch?: (messageId: string) => void | Promise<void>
  setActiveBranch?: (messageId: string) => void | Promise<void>
  deleteMessageGroup?: (parentId: string) => void | Promise<void>
  deleteMessageGroupWithConfirm?: (parentId: string) => void | Promise<void>
  regenerateMessage?: (messageId: string) => void | Promise<void>
}

export interface MessageListMeta {
  selectionLayer: boolean
  userProfile?: MessageUserProfile
  assistantProfile?: MessageUserProfile
  imageExportFileName?: string
}

export interface MessageListProviderValue {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}
