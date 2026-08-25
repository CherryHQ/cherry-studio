import type { Context, ReactNode } from 'react'
import { createContext, use, useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'

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
 * - `MessageListUiStaticContext` — preference-driven static config (menuConfig,
 *   translationLanguages). Changes when the user flips a
 *   setting.
 * - `MessageListUiSelectorsContext` — per-message getter functions
 *   (getMessageUiState, getMessageSiblings, getMessageActivityState,
 *   isMessageTranslating, getFileView, isToolAutoApproved, getTranslationLanguageLabel). Reference
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
  | 'messageTail'
  | 'activeTurnStatus'
  | 'isInitialLoading'
  | 'isMessagesStale'
  | 'hasOlder'
  | 'messageNavigation'
  | 'estimateSize'
  | 'overscan'
  | 'loadOlderDelayMs'
  | 'loadingResetDelayMs'
  | 'listKey'
  | 'streamingLayers'
>

type MessageListMessagesValue = MessageListItem[]

type MessageListUiStaticValue = Pick<
  MessageListState,
  'menuConfig' | 'translationLanguages' | 'translationLanguagesStatus'
>

type MessageListUiSelectorsValue = Pick<
  MessageListState,
  | 'getMessageUiState'
  | 'getMessageSiblings'
  | 'getMessageActivityState'
  | 'isMessageTranslating'
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

interface MessageListEditingStore {
  isEditing: (messageId: string) => boolean
  setEditingMessageId: (messageId: string | null) => void
  subscribe: (messageId: string, listener: () => void) => () => void
}

const createMessageListEditingStore = (initialMessageId: string | null): MessageListEditingStore => {
  let editingMessageId = initialMessageId
  const listenersByMessageId = new Map<string, Set<() => void>>()

  return {
    isEditing: (messageId) => editingMessageId === messageId,
    setEditingMessageId: (messageId) => {
      if (messageId === editingMessageId) return

      const previousMessageId = editingMessageId
      editingMessageId = messageId

      if (previousMessageId) {
        listenersByMessageId.get(previousMessageId)?.forEach((listener) => listener())
      }
      if (messageId) {
        listenersByMessageId.get(messageId)?.forEach((listener) => listener())
      }
    },
    subscribe: (messageId, listener) => {
      const listeners = listenersByMessageId.get(messageId) ?? new Set<() => void>()
      listeners.add(listener)
      listenersByMessageId.set(messageId, listeners)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) listenersByMessageId.delete(messageId)
      }
    }
  }
}

const MessageListEditingStoreContext = createContext<MessageListEditingStore | null>(null)

export const MessageListProvider = ({ value, children }: { value: MessageListProviderValue; children: ReactNode }) => {
  const { state, actions, meta } = value
  const editingMessageId = state.editingMessageId ?? null
  const [editingStore] = useState(() => createMessageListEditingStore(editingMessageId))

  useLayoutEffect(() => {
    editingStore.setEditingMessageId(editingMessageId)
  }, [editingMessageId, editingStore])

  const data = useMemo<MessageListDataValue>(
    () => ({
      topic: state.topic,
      beforeList: state.beforeList,
      messageTail: state.messageTail,
      activeTurnStatus: state.activeTurnStatus,
      isInitialLoading: state.isInitialLoading,
      isMessagesStale: state.isMessagesStale,
      hasOlder: state.hasOlder,
      messageNavigation: state.messageNavigation,
      estimateSize: state.estimateSize,
      overscan: state.overscan,
      loadOlderDelayMs: state.loadOlderDelayMs,
      loadingResetDelayMs: state.loadingResetDelayMs,
      listKey: state.listKey,
      streamingLayers: state.streamingLayers
    }),
    [
      state.topic,
      state.beforeList,
      state.messageTail,
      state.activeTurnStatus,
      state.isInitialLoading,
      state.isMessagesStale,
      state.hasOlder,
      state.messageNavigation,
      state.estimateSize,
      state.overscan,
      state.loadOlderDelayMs,
      state.loadingResetDelayMs,
      state.listKey,
      state.streamingLayers
    ]
  )

  const uiStatic = useMemo<MessageListUiStaticValue>(
    () => ({
      menuConfig: state.menuConfig,
      translationLanguages: state.translationLanguages,
      translationLanguagesStatus: state.translationLanguagesStatus
    }),
    [state.menuConfig, state.translationLanguages, state.translationLanguagesStatus]
  )

  const uiSelectors = useMemo<MessageListUiSelectorsValue>(
    () => ({
      getMessageUiState: state.getMessageUiState,
      getMessageSiblings: state.getMessageSiblings,
      getMessageActivityState: state.getMessageActivityState,
      isMessageTranslating: state.isMessageTranslating,
      getFileView: state.getFileView,
      isToolAutoApproved: state.isToolAutoApproved,
      getTranslationLanguageLabel: state.getTranslationLanguageLabel
    }),
    [
      state.getMessageUiState,
      state.getMessageSiblings,
      state.getMessageActivityState,
      state.isMessageTranslating,
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
                      <MessageListEditingStoreContext value={editingStore}>{children}</MessageListEditingStoreContext>
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

/** Topic id of the surrounding message list; undefined in embeds without one. */
export const useOptionalMessageListTopicId = (): string | undefined => {
  return use(MessageListDataContext)?.topic.id
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

/**
 * Optional renderer for the active turn's processing status (e.g. agent api-retry). Reads the Data
 * context narrowly, so it only re-renders when list metadata changes — not on every stream chunk.
 * Returns null when unset (regular chat) or when used outside a provider.
 */
export const useMessageListActiveTurnStatus = (): ((placeholder: ReactNode) => ReactNode) | null => {
  return use(MessageListDataContext)?.activeTurnStatus ?? null
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

/** Whether this message is currently being edited. Embeds without editing state return false. */
export const useIsMessageEditing = (messageId: string): boolean => {
  const store = use(MessageListEditingStoreContext)
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(messageId, listener) ?? (() => {}),
    [messageId, store]
  )
  const getSnapshot = useCallback(() => store?.isEditing(messageId) ?? false, [messageId, store])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

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
