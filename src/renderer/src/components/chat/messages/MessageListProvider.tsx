import type { Context, ReactNode } from 'react'
import { createContext, use, useMemo } from 'react'

import type {
  MessageListActions,
  MessageListMeta,
  MessageListProviderValue,
  MessageListSelectionState,
  MessageListState,
  MessageRenderConfig
} from './types'

type MessageListDataValue = Pick<
  MessageListState,
  | 'topic'
  | 'messages'
  | 'beforeList'
  | 'isInitialLoading'
  | 'hasOlder'
  | 'messageNavigation'
  | 'estimateSize'
  | 'overscan'
  | 'loadOlderDelayMs'
  | 'loadingResetDelayMs'
  | 'listKey'
>

type MessageListUiValue = Pick<
  MessageListState,
  | 'readonly'
  | 'editorConfig'
  | 'menuConfig'
  | 'translationLanguages'
  | 'editorTranslationTargetLabel'
  | 'getMessageUiState'
  | 'getMessageSiblings'
  | 'getMessageActivityState'
  | 'getMessageEditorCapabilities'
  | 'isToolAutoApproved'
  | 'externalCodeEditors'
  | 'getTranslationLanguageLabel'
>

const MessageListDataContext = createContext<MessageListDataValue | null>(null)
const MessageListPartsContext = createContext<MessageListState['partsByMessageId'] | null>(null)
const MessageListActionsContext = createContext<MessageListActions | null>(null)
const MessageListMetaContext = createContext<MessageListMeta | null>(null)
const MessageListRenderConfigContext = createContext<MessageRenderConfig | null>(null)
const MessageListSelectionContext = createContext<MessageListSelectionState | undefined | null>(null)
const MessageListUiContext = createContext<MessageListUiValue | null>(null)

export const MessageListProvider = ({ value, children }: { value: MessageListProviderValue; children: ReactNode }) => {
  const { state, actions, meta } = value

  const data = useMemo<MessageListDataValue>(
    () => ({
      topic: state.topic,
      messages: state.messages,
      beforeList: state.beforeList,
      isInitialLoading: state.isInitialLoading,
      hasOlder: state.hasOlder,
      messageNavigation: state.messageNavigation,
      estimateSize: state.estimateSize,
      overscan: state.overscan,
      loadOlderDelayMs: state.loadOlderDelayMs,
      loadingResetDelayMs: state.loadingResetDelayMs,
      listKey: state.listKey
    }),
    [
      state.topic,
      state.messages,
      state.beforeList,
      state.isInitialLoading,
      state.hasOlder,
      state.messageNavigation,
      state.estimateSize,
      state.overscan,
      state.loadOlderDelayMs,
      state.loadingResetDelayMs,
      state.listKey
    ]
  )

  const ui = useMemo<MessageListUiValue>(
    () => ({
      readonly: state.readonly,
      editorConfig: state.editorConfig,
      menuConfig: state.menuConfig,
      translationLanguages: state.translationLanguages,
      editorTranslationTargetLabel: state.editorTranslationTargetLabel,
      getMessageUiState: state.getMessageUiState,
      getMessageSiblings: state.getMessageSiblings,
      getMessageActivityState: state.getMessageActivityState,
      getMessageEditorCapabilities: state.getMessageEditorCapabilities,
      isToolAutoApproved: state.isToolAutoApproved,
      externalCodeEditors: state.externalCodeEditors,
      getTranslationLanguageLabel: state.getTranslationLanguageLabel
    }),
    [
      state.readonly,
      state.editorConfig,
      state.menuConfig,
      state.translationLanguages,
      state.editorTranslationTargetLabel,
      state.getMessageUiState,
      state.getMessageSiblings,
      state.getMessageActivityState,
      state.getMessageEditorCapabilities,
      state.isToolAutoApproved,
      state.externalCodeEditors,
      state.getTranslationLanguageLabel
    ]
  )

  return (
    <MessageListDataContext value={data}>
      <MessageListPartsContext value={state.partsByMessageId}>
        <MessageListActionsContext value={actions}>
          <MessageListMetaContext value={meta}>
            <MessageListRenderConfigContext value={state.renderConfig}>
              <MessageListSelectionContext value={state.selection}>
                <MessageListUiContext value={ui}>{children}</MessageListUiContext>
              </MessageListSelectionContext>
            </MessageListRenderConfigContext>
          </MessageListMetaContext>
        </MessageListActionsContext>
      </MessageListPartsContext>
    </MessageListDataContext>
  )
}

const useRequiredContext = <T,>(context: Context<T | null>, name: string): T => {
  const value = use(context)
  if (value === null) {
    throw new Error(`${name} must be used within MessageListProvider`)
  }
  return value
}

export const useOptionalMessageListActions = (): MessageListActions | undefined => {
  return use(MessageListActionsContext) ?? undefined
}

export const useOptionalMessageListUi = (): MessageListUiValue | undefined => {
  return use(MessageListUiContext) ?? undefined
}

export const useMessageListData = (): MessageListDataValue => {
  return useRequiredContext(MessageListDataContext, 'useMessageListData')
}

export const useMessageListParts = (): MessageListState['partsByMessageId'] => {
  return useRequiredContext(MessageListPartsContext, 'useMessageListParts')
}

export const useMessageListActions = (): MessageListActions => {
  return useRequiredContext(MessageListActionsContext, 'useMessageListActions')
}

export const useMessageListMeta = (): MessageListMeta => {
  return useRequiredContext(MessageListMetaContext, 'useMessageListMeta')
}

export const useMessageRenderConfig = (): MessageRenderConfig => {
  return useRequiredContext(MessageListRenderConfigContext, 'useMessageRenderConfig')
}

export const useMessageListSelection = (): MessageListSelectionState | undefined => {
  const value = use(MessageListSelectionContext)
  if (value === null) {
    throw new Error('useMessageListSelection must be used within MessageListProvider')
  }
  return value
}

export const useMessageListUi = (): MessageListUiValue => {
  return useRequiredContext(MessageListUiContext, 'useMessageListUi')
}
