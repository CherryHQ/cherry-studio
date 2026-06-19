import type { Context, ReactNode } from 'react'
import { createContext, use, useMemo } from 'react'

import { PartsProvider } from './blocks/MessagePartsContext'
import type {
  MessageListActions,
  MessageListItem,
  MessageListMeta,
  MessageListProviderValue,
  MessageListSelectionState,
  MessageListState,
  MessageRenderConfig
} from './types'

/**
 * Context layering for the message list (PR 2 split):
 *
 * - `MessageListDataContext`  — slow-moving list metadata (topic, sizing,
 *   navigation flags). Does NOT carry the messages array; that lives in
 *   `MessageListMessagesContext` below so a streaming chunk does not invalidate
 *   subscribers that only care about, say, `estimateSize`.
 * - `MessageListMessagesContext` — the messages array itself. Streaming chunks
 *   land here.
 * - `MessageListUiStaticContext` — preference-driven static config (readonly,
 *   menuConfig, translationLanguages, externalCodeEditors). Changes when the
 *   user flips a setting.
 * - `MessageListUiSelectorsContext` — per-message getter functions
 *   (getMessageUiState, getMessageSiblings, getMessageActivityState,
 *   getFileView, isToolAutoApproved, getTranslationLanguageLabel). Reference
 *   changes when the underlying selectors are rebuilt (rare in practice).
 *
 * Existing consumers continue to use the merged `useMessageListUi()` /
 * `useMessageListData()` for back-compat; high-frequency consumers
 * (MessageGroup, MessageFrame) should switch to the narrow split hooks to
 * shed unnecessary re-renders.
 */

type MessageListDataValue = Pick<
  MessageListState,
  | 'topic'
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

type MessageListMessagesValue = MessageListItem[]

type MessageListUiStaticValue = Pick<
  MessageListState,
  'readonly' | 'menuConfig' | 'translationLanguages' | 'externalCodeEditors'
>

type MessageListUiSelectorsValue = Pick<
  MessageListState,
  | 'getMessageUiState'
  | 'getMessageSiblings'
  | 'getMessageActivityState'
  | 'getFileView'
  | 'isToolAutoApproved'
  | 'getTranslationLanguageLabel'
>

type MessageListUiValue = MessageListUiStaticValue & MessageListUiSelectorsValue
type MessageListDataLegacyValue = MessageListDataValue & { messages: MessageListItem[] }

const MessageListDataContext = createContext<MessageListDataValue | null>(null)
const MessageListMessagesContext = createContext<MessageListMessagesValue | null>(null)
const MessageListActionsContext = createContext<MessageListActions | null>(null)
const MessageListMetaContext = createContext<MessageListMeta | null>(null)
const MessageListRenderConfigContext = createContext<MessageRenderConfig | null>(null)
const MessageListSelectionContext = createContext<MessageListSelectionState | undefined | null>(null)
const MessageListUiStaticContext = createContext<MessageListUiStaticValue | null>(null)
const MessageListUiSelectorsContext = createContext<MessageListUiSelectorsValue | null>(null)
const MessageListEditingContext = createContext<string | null>(null)

export const MessageListProvider = ({ value, children }: { value: MessageListProviderValue; children: ReactNode }) => {
  const { state, actions, meta } = value

  const data = useMemo<MessageListDataValue>(
    () => ({
      topic: state.topic,
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

  const uiStatic = useMemo<MessageListUiStaticValue>(
    () => ({
      readonly: state.readonly,
      menuConfig: state.menuConfig,
      translationLanguages: state.translationLanguages,
      externalCodeEditors: state.externalCodeEditors
    }),
    [state.readonly, state.menuConfig, state.translationLanguages, state.externalCodeEditors]
  )

  const uiSelectors = useMemo<MessageListUiSelectorsValue>(
    () => ({
      getMessageUiState: state.getMessageUiState,
      getMessageSiblings: state.getMessageSiblings,
      getMessageActivityState: state.getMessageActivityState,
      getFileView: state.getFileView,
      isToolAutoApproved: state.isToolAutoApproved,
      getTranslationLanguageLabel: state.getTranslationLanguageLabel
    }),
    [
      state.getMessageUiState,
      state.getMessageSiblings,
      state.getMessageActivityState,
      state.getFileView,
      state.isToolAutoApproved,
      state.getTranslationLanguageLabel
    ]
  )

  return (
    <MessageListDataContext value={data}>
      <MessageListMessagesContext value={state.messages}>
        <PartsProvider value={state.partsByMessageId}>
          <MessageListActionsContext value={actions}>
            <MessageListMetaContext value={meta}>
              <MessageListRenderConfigContext value={state.renderConfig}>
                <MessageListSelectionContext value={state.selection}>
                  <MessageListUiStaticContext value={uiStatic}>
                    <MessageListUiSelectorsContext value={uiSelectors}>
                      <MessageListEditingContext value={state.editingMessageId ?? null}>
                        {children}
                      </MessageListEditingContext>
                    </MessageListUiSelectorsContext>
                  </MessageListUiStaticContext>
                </MessageListSelectionContext>
              </MessageListRenderConfigContext>
            </MessageListMetaContext>
          </MessageListActionsContext>
        </PartsProvider>
      </MessageListMessagesContext>
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

/**
 * Back-compat hook: returns the merged static + selectors UI value. Subscribes
 * to BOTH underlying contexts, so it re-renders on either update — fine for
 * low-frequency consumers (settings dropdowns, tools menubars). High-frequency
 * consumers should switch to `useMessageListUiSelectors()` or
 * `useMessageListUiStatic()`.
 */
export const useOptionalMessageListUi = (): MessageListUiValue | undefined => {
  const stat = use(MessageListUiStaticContext)
  const sel = use(MessageListUiSelectorsContext)
  return useMemo<MessageListUiValue | undefined>(() => {
    if (stat === null || sel === null) return undefined
    return { ...stat, ...sel }
  }, [stat, sel])
}

export const useMessageListUiStatic = (): MessageListUiStaticValue => {
  return useRequiredContext(MessageListUiStaticContext, 'useMessageListUiStatic')
}

export const useMessageListUiSelectors = (): MessageListUiSelectorsValue => {
  return useRequiredContext(MessageListUiSelectorsContext, 'useMessageListUiSelectors')
}

/**
 * Back-compat: returns the legacy combined shape ({ topic, messages, ... }).
 * Subscribes to both Data and Messages contexts. New code should use
 * `useMessageListMessages()` for the array slice and `useMessageListData()`
 * (which now excludes messages) for the metadata slice.
 */
export const useMessageListData = (): MessageListDataLegacyValue => {
  const data = useRequiredContext(MessageListDataContext, 'useMessageListData')
  const messages = useRequiredContext(MessageListMessagesContext, 'useMessageListData')
  return useMemo(() => ({ ...data, messages }), [data, messages])
}

export const useMessageListMessages = (): MessageListItem[] => {
  return useRequiredContext(MessageListMessagesContext, 'useMessageListMessages')
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

/** Id of the message currently being edited (null when none). Non-throwing: "not editing"
 * is a valid state, so embeds that never set it simply get null. */
export const useMessageListEditingId = (): string | null => use(MessageListEditingContext)

/**
 * Back-compat hook: merged static + selectors UI value. Required variant
 * (throws when missing); the optional variant is `useOptionalMessageListUi`.
 * Prefer the split hooks for high-frequency consumers.
 */
export const useMessageListUi = (): MessageListUiValue => {
  const stat = useRequiredContext(MessageListUiStaticContext, 'useMessageListUi')
  const sel = useRequiredContext(MessageListUiSelectorsContext, 'useMessageListUi')
  return useMemo(() => ({ ...stat, ...sel }), [stat, sel])
}
