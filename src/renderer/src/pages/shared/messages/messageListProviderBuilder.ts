import type {
  MessageListActions,
  MessageListMeta,
  MessageListProviderValue,
  MessageListState
} from '@renderer/components/chat/messages/types'

type MessageLeafStateCapabilities = Pick<MessageListState, 'getFileView' | 'isToolAutoApproved' | 'externalCodeEditors'>

type MessageLeafActionCapabilities = Pick<
  MessageListActions,
  | 'previewFile'
  | 'subscribeToolProgress'
  | 'openExternalUrl'
  | 'openInExternalApp'
  | 'uploadEditorFiles'
  | 'handleEditorPaste'
  | 'bindEditorPasteHandler'
  | 'focusEditorPasteTarget'
  | 'getDroppedEditorFiles'
  | 'copyText'
  | 'copyRichContent'
  | 'copyImage'
  | 'exportTableAsExcel'
  | 'notifyInfo'
  | 'notifySuccess'
  | 'notifyWarning'
  | 'notifyError'
>

type MessageHeaderActionCapabilities = Pick<MessageListActions, 'openUserProfile' | 'openProviderApp'>

interface MessageProviderValueInput {
  state: MessageListState
  actions: MessageListActions
  meta: MessageListMeta
}

export function createMessageListProviderValue({
  state,
  actions,
  meta
}: MessageProviderValueInput): MessageListProviderValue {
  return { state, actions, meta }
}

export function pickMessageLeafState(
  capabilities: Partial<MessageLeafStateCapabilities>
): Partial<MessageLeafStateCapabilities> {
  const state: Partial<MessageLeafStateCapabilities> = {}

  if (capabilities.getFileView) {
    state.getFileView = capabilities.getFileView
  }

  if (capabilities.isToolAutoApproved) {
    state.isToolAutoApproved = capabilities.isToolAutoApproved
  }

  if (capabilities.externalCodeEditors !== undefined) {
    state.externalCodeEditors = capabilities.externalCodeEditors
  }

  return state
}

export function pickMessageLeafActions(
  capabilities: Partial<MessageLeafActionCapabilities>
): Partial<MessageLeafActionCapabilities> {
  const actions: Partial<MessageLeafActionCapabilities> = {}

  if (capabilities.previewFile) actions.previewFile = capabilities.previewFile
  if (capabilities.subscribeToolProgress) actions.subscribeToolProgress = capabilities.subscribeToolProgress
  if (capabilities.openExternalUrl) actions.openExternalUrl = capabilities.openExternalUrl
  if (capabilities.openInExternalApp) actions.openInExternalApp = capabilities.openInExternalApp
  if (capabilities.uploadEditorFiles) actions.uploadEditorFiles = capabilities.uploadEditorFiles
  if (capabilities.handleEditorPaste) actions.handleEditorPaste = capabilities.handleEditorPaste
  if (capabilities.bindEditorPasteHandler) actions.bindEditorPasteHandler = capabilities.bindEditorPasteHandler
  if (capabilities.focusEditorPasteTarget) actions.focusEditorPasteTarget = capabilities.focusEditorPasteTarget
  if (capabilities.getDroppedEditorFiles) actions.getDroppedEditorFiles = capabilities.getDroppedEditorFiles
  if (capabilities.copyText) actions.copyText = capabilities.copyText
  if (capabilities.copyRichContent) actions.copyRichContent = capabilities.copyRichContent
  if (capabilities.copyImage) actions.copyImage = capabilities.copyImage
  if (capabilities.exportTableAsExcel) actions.exportTableAsExcel = capabilities.exportTableAsExcel
  if (capabilities.notifyInfo) actions.notifyInfo = capabilities.notifyInfo
  if (capabilities.notifySuccess) actions.notifySuccess = capabilities.notifySuccess
  if (capabilities.notifyWarning) actions.notifyWarning = capabilities.notifyWarning
  if (capabilities.notifyError) actions.notifyError = capabilities.notifyError

  return actions
}

export function pickMessageHeaderActions(
  capabilities: Partial<MessageHeaderActionCapabilities>
): Partial<MessageHeaderActionCapabilities> {
  const actions: Partial<MessageHeaderActionCapabilities> = {}

  if (capabilities.openUserProfile) actions.openUserProfile = capabilities.openUserProfile
  if (capabilities.openProviderApp) actions.openProviderApp = capabilities.openProviderApp

  return actions
}
