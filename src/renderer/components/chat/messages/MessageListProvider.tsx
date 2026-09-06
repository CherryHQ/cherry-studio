import type { AgentLaunchIndex } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { useStableStringArray } from '@renderer/hooks/useStableStringArray'
import {
  buildCitationPartsRegistry,
  type CitationPartsRegistry,
  EMPTY_CITATION_PARTS_REGISTRY,
  getPriorCitationParts
} from '@renderer/utils/message/citations'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Context, ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useRef, useSyncExternalStore } from 'react'

import { AgentLaunchIndexProvider, PartsProvider } from './blocks/MessagePartsContext'
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
 *   (getMessageUiState, getMessageSiblings,
 *   isMessageTranslating, getFileView, isToolAutoApproved, getTranslationLanguageLabel). Reference
 *   changes when the underlying selectors are rebuilt (rare in practice).
 * - `MessageListActivityContext` — stable keyed activity store and legacy getter.
 *   Message frames subscribe only to their own message id.
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
  | 'isMessageTranslating'
  | 'getFileView'
  | 'isToolAutoApproved'
  | 'getTranslationLanguageLabel'
>

type MessageListActivityValue = Pick<MessageListState, 'getMessageActivityState' | 'messageActivityStore'>

type MessageListUiValue = MessageListUiStaticValue &
  MessageListUiSelectorsValue &
  Pick<MessageListActivityValue, 'getMessageActivityState'>
type MessageListDataLegacyValue = MessageListDataValue & { messages: MessageListItem[] }

const MessageListDataContext = createContext<MessageListDataValue | null>(null)
const MessageListMessagesContext = createContext<MessageListMessagesValue | null>(null)
const MessageListActionsContext = createContext<MessageListActions | null>(null)
const MessageListMetaContext = createContext<MessageListMeta | null>(null)
const MessageListRenderConfigContext = createContext<MessageRenderConfig | null>(null)
const MessageListSelectionContext = createContext<MessageListSelectionState | undefined | null>(null)
const MessageListUiStaticContext = createContext<MessageListUiStaticValue | null>(null)
const MessageListUiSelectorsContext = createContext<MessageListUiSelectorsValue | null>(null)
const MessageListActivityContext = createContext<MessageListActivityValue | null>(null)
const MessageListEditingContext = createContext<string | null>(null)
const MessageListCitationRegistryContext = createContext<CitationPartsRegistry | null>(null)

/**
 * Cross-turn citation registry. Keyed on the stable id order and the history
 * parts layer (never the streaming overlay), so a streaming chunk does not
 * rebuild it; `previous` keeps the identity when nothing citable changed.
 */
function useCitationPartsRegistry(state: MessageListState): CitationPartsRegistry {
  const messageIds = useStableStringArray(useMemo(() => state.messages.map((message) => message.id), [state.messages]))
  const partsSource = state.streamingLayers?.historyPartsByMessageId ?? state.partsByMessageId
  const previousRef = useRef(EMPTY_CITATION_PARTS_REGISTRY)
  return useMemo(() => {
    const next = buildCitationPartsRegistry(messageIds, partsSource, previousRef.current)
    previousRef.current = next
    return next
  }, [messageIds, partsSource])
}

export const MessageListProvider = ({
  value,
  children,
  buildLaunchIndex
}: {
  value: MessageListProviderValue
  children: ReactNode
  /** Agent launch-identity index builder — only agent-hosting pages opt in. */
  buildLaunchIndex?: (partsByMessageId: Record<string, CherryMessagePart[]> | null) => AgentLaunchIndex
}) => {
  const { state, actions, meta } = value
  const citationRegistry = useCitationPartsRegistry(state)

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
      isMessageTranslating: state.isMessageTranslating,
      getFileView: state.getFileView,
      isToolAutoApproved: state.isToolAutoApproved,
      getTranslationLanguageLabel: state.getTranslationLanguageLabel
    }),
    [
      state.getMessageUiState,
      state.getMessageSiblings,
      state.isMessageTranslating,
      state.getFileView,
      state.isToolAutoApproved,
      state.getTranslationLanguageLabel
    ]
  )

  const activity = useMemo<MessageListActivityValue>(
    () => ({
      getMessageActivityState: state.getMessageActivityState,
      messageActivityStore: state.messageActivityStore
    }),
    [state.getMessageActivityState, state.messageActivityStore]
  )

  // The launch index is derived once per parts-map version so streaming chunks rebuild it a
  // single time instead of once per mounted resume-receipt consumer. A page that does not host
  // agents simply omits the builder and skips the index entirely.
  const launchIndex = useMemo(
    () => (buildLaunchIndex ? buildLaunchIndex(state.partsByMessageId) : null),
    [buildLaunchIndex, state.partsByMessageId]
  )

  return (
    <MessageListDataContext value={data}>
      <MessageListMessagesContext value={state.messages}>
        <AgentLaunchIndexProvider value={launchIndex}>
          <PartsProvider value={state.partsByMessageId}>
            <MessageListCitationRegistryContext value={citationRegistry}>
              <MessageListActionsContext value={actions}>
                <MessageListMetaContext value={meta}>
                  <MessageListRenderConfigContext value={state.renderConfig}>
                    <MessageListSelectionContext value={state.selection}>
                      <MessageListUiStaticContext value={uiStatic}>
                        <MessageListUiSelectorsContext value={uiSelectors}>
                          <MessageListActivityContext value={activity}>
                            <MessageListEditingContext value={state.editingMessageId ?? null}>
                              {children}
                            </MessageListEditingContext>
                          </MessageListActivityContext>
                        </MessageListUiSelectorsContext>
                      </MessageListUiStaticContext>
                    </MessageListSelectionContext>
                  </MessageListRenderConfigContext>
                </MessageListMetaContext>
              </MessageListActionsContext>
            </MessageListCitationRegistryContext>
          </PartsProvider>
        </AgentLaunchIndexProvider>
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
  const activity = use(MessageListActivityContext)
  return useMemo<MessageListUiValue | undefined>(() => {
    if (stat === null || sel === null || activity === null) return undefined
    return { ...stat, ...sel, getMessageActivityState: activity.getMessageActivityState }
  }, [activity, stat, sel])
}

export const useMessageListUiStatic = (): MessageListUiStaticValue => {
  return useRequiredContext(MessageListUiStaticContext, 'useMessageListUiStatic')
}

export const useMessageListUiSelectors = (): MessageListUiSelectorsValue => {
  return useRequiredContext(MessageListUiSelectorsContext, 'useMessageListUiSelectors')
}

const INACTIVE_MESSAGE_ACTIVITY_STATE = Object.freeze({
  isProcessing: false,
  isStreamTarget: false,
  isApprovalAnchor: false
})

export const useMessageListItemActivityState = (message: MessageListItem) => {
  const activity = useRequiredContext(MessageListActivityContext, 'useMessageListItemActivityState')
  const store = activity.messageActivityStore
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(message.id, listener) ?? (() => {}),
    [message.id, store]
  )
  const getSnapshot = useCallback(
    () => store?.getSnapshot(message) ?? INACTIVE_MESSAGE_ACTIVITY_STATE,
    [message, store]
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return store ? snapshot : (activity.getMessageActivityState?.(message) ?? INACTIVE_MESSAGE_ACTIVITY_STATE)
}

export const useAnyMessageListItemProcessing = (messages: readonly MessageListItem[]) => {
  const activity = useRequiredContext(MessageListActivityContext, 'useAnyMessageListItemProcessing')
  const store = activity.messageActivityStore
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!store) return () => {}
      const unsubscribes = messages.map((message) => store.subscribe(message.id, listener))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [messages, store]
  )
  const getSnapshot = useCallback(
    () =>
      messages.some((message) => {
        const state = store?.getSnapshot(message) ?? activity.getMessageActivityState?.(message)
        return state?.isProcessing ?? message.status === 'pending'
      }),
    [activity, messages, store]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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

/** Id of the message currently being edited (null when none). Non-throwing: "not editing"
 * is a valid state, so embeds that never set it simply get null. */
export const useMessageListEditingId = (): string | null => use(MessageListEditingContext)

/** Citable tool parts of every message before `messageId` in list order; empty outside a provider. */
export const useMessagePriorCitationParts = (messageId: string): readonly CherryMessagePart[] => {
  const registry = use(MessageListCitationRegistryContext) ?? EMPTY_CITATION_PARTS_REGISTRY
  return useMemo(() => getPriorCitationParts(registry, messageId), [registry, messageId])
}

/**
 * Back-compat hook: merged static + selectors UI value. Required variant
 * (throws when missing); the optional variant is `useOptionalMessageListUi`.
 * Prefer the split hooks for high-frequency consumers.
 */
export const useMessageListUi = (): MessageListUiValue => {
  const stat = useRequiredContext(MessageListUiStaticContext, 'useMessageListUi')
  const sel = useRequiredContext(MessageListUiSelectorsContext, 'useMessageListUi')
  const activity = useRequiredContext(MessageListActivityContext, 'useMessageListUi')
  return useMemo(
    () => ({ ...stat, ...sel, getMessageActivityState: activity.getMessageActivityState }),
    [activity, stat, sel]
  )
}
