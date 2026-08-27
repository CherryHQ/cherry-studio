import type { Context, ReactNode } from 'react'
import { useCallback, createContext, use, useMemo, useSyncExternalStore } from 'react'

import { PartsProvider } from './blocks/MessagePartsContext'
import type { MessageSelectionStore } from '@renderer/components/chat/messages/selection/MessageSelectionStore'
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

/**
 * Mode-only projection of the selection state (enabled / multi-select). Changes
 * identity ONLY when the mode toggles — never when the selected-id set grows
 * or shrinks — so per-frame subscribers stay idle during selection (#19209).
 */
const MessageListSelectionModeContext = createContext<
  Pick<MessageListSelectionState, 'enabled' | 'isMultiSelectMode'> | undefined | null
>(null)

/** Per-message selection subscription store; null in embeds without selection. */
const MessageSelectionStoreContext = createContext<MessageSelectionStore | null>(null)
const MessageListUiStaticContext = createContext<MessageListUiStaticValue | null>(null)
const MessageListUiSelectorsContext = createContext<MessageListUiSelectorsValue | null>(null)
const MessageListEditingContext = createContext<string | null>(null)

export const MessageListProvider = ({ value, children }: { value: MessageListProviderValue; children: ReactNode }) => {
  const { selectionStore } = value
  const { state, actions, meta } = value

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

  const selectionMode = useMemo(
    () =>
      state.selection
        ? { enabled: state.selection.enabled, isMultiSelectMode: state.selection.isMultiSelectMode }
        : undefined,
    [state.selection?.enabled, state.selection?.isMultiSelectMode]
  )

  return (
    <MessageListDataContext value={data}>
      <MessageListMessagesContext value={state.messages}>
        <PartsProvider value={state.partsByMessageId}>
          <MessageListActionsContext value={actions}>
            <MessageListMetaContext value={meta}>
              <MessageListRenderConfigContext value={state.renderConfig}>
                <MessageListSelectionModeContext value={selectionMode}>
                  <MessageSelectionStoreContext value={selectionStore ?? null}>
                    <MessageListSelectionModeContext value={selectionMode}>
                      <MessageSelectionStoreContext value={selectionStore ?? null}>
                        <MessageListSelectionContext value={state.selection}>
                          <MessageListUiStaticContext value={uiStatic}>
                            <MessageListUiSelectorsContext value={uiSelectors}>
                              <MessageListEditingContext value={state.editingMessageId ?? null}>
                                {children}
                              </MessageListEditingContext>
                            </MessageListUiSelectorsContext>
                          </MessageListUiStaticContext>
                        </MessageListSelectionContext>
                      </MessageSelectionStoreContext>
                    </MessageListSelectionModeContext>
                  </MessageSelectionStoreContext>
                </MessageListSelectionModeContext>
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

/**
 * Mode-only selection view (enabled / multi-select). Identity changes only
 * when the mode toggles — not on selection-set changes (#19209).
 */
export const useMessageSelectionMode = ():
  | Pick<MessageListSelectionState, 'enabled' | 'isMultiSelectMode'>
  | undefined => {
  const value = use(MessageListSelectionModeContext)
  if (value === null) {
    throw new Error('useMessageSelectionMode must be used within MessageListProvider')
  }
  return value
}

/**
 * Per-message selected-state subscription: re-renders only when THIS message's
 * boolean flips, not when the selection set changes elsewhere (#19209).
 * Outside a selecting list (no store) the answer is always false.
 */
export const useIsMessageSelected = (messageId: string): boolean => {
  const store = use(MessageSelectionStoreContext)
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribeId(messageId, listener) : () => {}),
    [store, messageId]
  )
  return useSyncExternalStore(
    subscribe,
    () => store?.isSelected(messageId) ?? false,
    () => false
  )
}

/**
 * Full selected-id list via the store: stable identity between changes; used
 * by the toolbar / popup / whole-list consumers that genuinely need every id.
 */
export const useSelectedMessageIds = (): readonly string[] => {
  const store = use(MessageSelectionStoreContext)
  const subscribe = useCallback((listener: () => void) => (store ? store.subscribeList(listener) : () => {}), [store])
  return useSyncExternalStore(
    subscribe,
    () => store?.getSnapshot() ?? EMPTY_SELECTED_MESSAGE_IDS,
    () => EMPTY_SELECTED_MESSAGE_IDS
  )
}

const EMPTY_SELECTED_MESSAGE_IDS: readonly string[] = []

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
