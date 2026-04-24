import { useInvalidateCache, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { isDev } from '@renderer/config/constant'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { ToolApprovalProvider } from '@renderer/hooks/ToolApprovalContext'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { type V2ChatOverrides, V2ChatOverridesProvider } from '@renderer/hooks/V2ChatContext'
import type { Assistant, FileMetadata, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type {
  BranchMessagesResponse,
  CherryMessagePart,
  CherryUIMessage,
  ModelSnapshot
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, RefreshProvider } from './Messages/Blocks'
import ExecutionStreamCollector from './Messages/ExecutionStreamCollector'
import Messages from './Messages/Messages'
import { uiToMessage } from './uiToMessage'

const logger = loggerService.withContext('V2ChatContent')

interface Props {
  assistant: Assistant
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
}

/**
 * V2 chat content area.
 *
 * Outer shell (V2ChatContent):
 *   - Loads history from DataApi via useTopicMessagesV2
 *   - Renders loading state until history is ready
 *
 * Inner component (V2ChatContentInner):
 *   - Consumes official useChat over IPC transport
 *   - Stream lifecycle is decoupled from React by Main-side AiStreamManager;
 *     switching topics detaches the Renderer subscriber without aborting the stream
 *   - History (from DataApi) and active stream (from useChat) are separate sources
 *   - PartsContext: history parts + live streaming parts overlay
 */
const V2ChatContent: FC<Props> = ({ assistant, topic, setActiveTopic, mainHeight }) => {
  const { uiMessages, siblingsMap, isLoading: isHistoryLoading, refresh, activeNodeId } = useTopicMessagesV2(topic.id)

  // Don't mount the chat instance until history is loaded.
  // ChatSession only reads initialMessages on creation — if we create it
  // while history is still loading, the session starts with zero context.
  if (isHistoryLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center"
        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
        <div className="text-sm" style={{ color: 'var(--color-text-3)' }}>
          Loading conversation...
        </div>
      </div>
    )
  }

  return (
    <V2ChatContentInner
      assistant={assistant}
      topic={topic}
      setActiveTopic={setActiveTopic}
      mainHeight={mainHeight}
      initialMessages={uiMessages}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
    />
  )
}

// ============================================================================
// Inner component — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /**
   * Live DB-backed message list from `useTopicMessagesV2`. Reactive —
   * re-renders when SWR refreshes. Used as the base for render-time
   * merge with per-execution streaming overlays.
   */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessagesV2>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
}

const V2ChatContentInner: FC<InnerProps> = ({
  assistant,
  topic,
  setActiveTopic,
  mainHeight,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId
}) => {
  // const { isMultiSelectMode } = useChatContext(topic)

  const { sendMessage, regenerate, stop, error, setMessages, activeExecutionIds, addToolApprovalResponse } =
    useChatWithHistory(topic.id, initialMessages, refresh, { assistantId: assistant.id })

  const respondToToolApproval = useToolApprovalBridge({ addToolApprovalResponse })

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(
    () =>
      assistant.model
        ? {
            id: assistant.model.id,
            name: assistant.model.name,
            provider: assistant.model.provider,
            ...(assistant.model.group && { group: assistant.model.group })
          }
        : undefined,
    [assistant.model]
  )

  // ── Rendering pipeline (DB as source of truth) ─────────────────────
  //
  // The renderer message list is a pure projection of `uiMessages` — DB
  // truth as returned by `useTopicMessagesV2` (already bucketed by
  // modelId in `flattenBranchMessages`). AI SDK's `useChat.state.messages`
  // is NOT read here because `regenerate` truncates it in ways that
  // discard multi-model siblings, breaking the mixed-cohort layout.
  //
  // Streaming content for in-flight executions is overlaid into
  // `partsMap` below — matched by DB placeholder id, which Main uses
  // as the streaming message id. No list-level overlay is needed
  // because every in-flight bubble already exists in `uiMessages` as a
  // `status: 'pending'` row (Main reserves placeholders before the
  // first chunk, broadcasts 'pending', and refresh lands the row
  // before LLM latency delivers content).
  const lastUserIdInBase = useMemo(() => {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      if (uiMessages[i].role === 'user') return uiMessages[i].id
    }
    return undefined
  }, [uiMessages])

  const projectedMessages = useMemo<Message[]>(
    () =>
      uiMessages.map((m) =>
        uiToMessage(m, {
          assistantId: assistant.id,
          topicId: topic.id,
          askIdFallback: lastUserIdInBase,
          modelFallback: fallbackSnapshot
        })
      ),
    [uiMessages, assistant.id, topic.id, lastUserIdInBase, fallbackSnapshot]
  )

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) map[m.id] = (m.parts ?? []) as CherryMessagePart[]
    return map
  }, [uiMessages])

  // ── Per-execution streaming overlay ────────────────────────────────
  //
  // Each `ExecutionStreamCollector` (mounted below per `activeExecutionId`)
  // surfaces its live `parts` via `handleExecutionMessagesChange`. Main
  // tags every chunk with the DB placeholder id (see
  // `alwaysTagExecution: true` in `handleSendV2` / `regenerateWithCapabilities`
  // bodies + `AiStreamManager.onChunk`), so overlay ids match base ids
  // directly. `mergedPartsMap` replaces `basePartsMap[id]` with the live
  // parts for any id currently streaming.
  const [executionMessagesById, setExecutionMessagesById] = useState<Record<string, CherryUIMessage[]>>({})

  useEffect(() => {
    if (activeExecutionIds.length === 0) {
      setExecutionMessagesById({})
      return
    }
    const activeSet = new Set<string>(activeExecutionIds)
    setExecutionMessagesById((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([executionId]) => activeSet.has(executionId)))
    )
  }, [activeExecutionIds])

  const handleExecutionMessagesChange = useCallback((executionId: string, messages: CherryUIMessage[]) => {
    setExecutionMessagesById((prev) => ({ ...prev, [executionId]: messages }))
  }, [])

  const handleExecutionDispose = useCallback((executionId: string) => {
    setExecutionMessagesById((prev) => {
      if (!(executionId in prev)) return prev
      const next = { ...prev }
      delete next[executionId]
      return next
    })
  }, [])

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const execMessages of Object.values(executionMessagesById)) {
      for (const uiMessage of execMessages) {
        if (uiMessage.role === 'assistant' && uiMessage.parts?.length) {
          next[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
        }
      }
    }
    return next
  }, [basePartsMap, executionMessagesById])

  // ── Branch-messages cache control ──────────────────────────────────
  //
  // The four write handlers below maintain two parallel optimistic stores:
  //   (1) the shared SWR cache for `/topics/:id/messages` — read by every
  //       `useTopicMessagesV2` subscriber (including other detached windows),
  //   (2) `useChat`'s internal `messages` state — owned by the local instance,
  //       not fed from SWR after mount.
  //
  // Seeding (1) via `useWriteCache` closes the ~20–50ms gap in which other
  // subscribers would otherwise still see the stale server value while we
  // wait for `refresh:`'s revalidation round-trip.  Rollback on error goes
  // through `useInvalidateCache` (same pattern as `useReorder`).  (2) stays
  // manual because `useChat` owns its own store.
  const messagesCachePath = useMemo(() => `/topics/${topic.id}/messages` as const, [topic.id])
  const messagesCacheQuery = useMemo(() => ({ limit: 999, includeSiblings: true }), [])
  const messagesRefreshKeys = useMemo<`/topics/${string}/messages`[]>(
    () => [`/topics/${topic.id}/messages`],
    [topic.id]
  )

  const readCache = useReadCache()
  const writeCache = useWriteCache()
  const invalidateCache = useInvalidateCache()

  /** Compute the optimistic branch response with the given ids removed. */
  const branchWithoutIds = useCallback(
    (prev: BranchMessagesResponse, removedIds: Set<string>): BranchMessagesResponse => {
      const items = prev.items
        .filter((item) => !removedIds.has(item.message.id))
        .map((item) =>
          item.siblingsGroup
            ? { ...item, siblingsGroup: item.siblingsGroup.filter((s) => !removedIds.has(s.id)) }
            : item
        )
      return { ...prev, items }
    },
    []
  )

  /** Write a transformed cache value; returns the pre-transform snapshot for rollback. */
  const seedOptimisticBranch = useCallback(
    async (transform: (prev: BranchMessagesResponse) => BranchMessagesResponse) => {
      const prev = readCache<BranchMessagesResponse>(messagesCachePath, messagesCacheQuery)
      if (!prev) return
      await writeCache(messagesCachePath, transform(prev), messagesCacheQuery)
    },
    [messagesCachePath, messagesCacheQuery, readCache, writeCache]
  )

  /** Full rollback: force a revalidation against the server. */
  const rollbackBranch = useCallback(async () => {
    await invalidateCache(messagesCachePath)
  }, [invalidateCache, messagesCachePath])

  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: messagesRefreshKeys
  })

  const { trigger: patchMessageTrigger } = useMutation('PATCH', '/messages/:id', {
    refresh: messagesRefreshKeys
  })

  const { trigger: createSiblingTrigger } = useMutation('POST', '/messages/:id/siblings', {
    refresh: messagesRefreshKeys
  })

  const { trigger: setActiveNodeTrigger } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: messagesRefreshKeys
  })

  /**
   * Delete a single message (reparent children to grandparent) and sync UI.
   *
   * Two-phase: first try `cascade=false` (reparent). The server signals with
   * `INVALID_OPERATION` when the message has descendants the server can't
   * safely reparent (e.g. a sibling multi-model group); fall back to a
   * cascading delete. The retry is orchestrated by this handler because
   * `useMutation`'s single-trigger model doesn't express fallback paths.
   *
   * Optimistic flow:
   *   1. Seed SWR cache + useChat state with the single-id removal (matches
   *      the cascade=false expected outcome).
   *   2. Fire `cascade=false` trigger.
   *   3. On INVALID_OPERATION: re-seed with the full descendant set from the
   *      server response, then fire `cascade=true`.
   *   4. On any other error: roll back both stores.
   */
  const handleDeleteMessage = useCallback<V2ChatOverrides['deleteMessage']>(
    async (id, traceOptions) => {
      const optimisticIds = new Set([id])
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, optimisticIds))
      setMessages((msgs) => msgs.filter((m) => m.id !== id))

      try {
        await deleteMessageTrigger({ params: { id }, query: { cascade: false } })
      } catch (err: unknown) {
        if (err instanceof DataApiError && err.code === ErrorCode.INVALID_OPERATION) {
          try {
            const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
            const deletedSet = new Set(result.deletedIds)
            await seedOptimisticBranch((prev) => branchWithoutIds(prev, deletedSet))
            setMessages((msgs) => msgs.filter((m) => !deletedSet.has(m.id)))
          } catch (cascadeErr) {
            await rollbackBranch()
            throw cascadeErr
          }
        } else {
          await rollbackBranch()
          throw err
        }
      }
      // Best-effort: drop span-cache history for the turn we just removed.
      // Callers (`useMessage.remove`) pass `traceId`/`modelName` off the
      // assistant message; caller-less flows (multi-select) fall back to
      // `''` which targets the whole topic.
      void window.api.trace.cleanHistory(topic.id, traceOptions?.traceId ?? '', traceOptions?.modelName)
      logger.info('Deleted message', { id })
    },
    [branchWithoutIds, deleteMessageTrigger, rollbackBranch, seedOptimisticBranch, setMessages, topic.id]
  )

  /** Delete a message and all descendants (cascade) and sync UI. */
  const handleDeleteMessageGroup = useCallback(
    async (id: string) => {
      // Server response is the only authoritative source of deletedIds; we
      // can't pre-compute them client-side. Seed a best-effort single-id
      // optimistic removal first, then reconcile once the server answers.
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set([id])))

      try {
        const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
        const deletedSet = new Set(result.deletedIds)
        await seedOptimisticBranch((prev) => branchWithoutIds(prev, deletedSet))
        setMessages((msgs) => msgs.filter((m) => !deletedSet.has(m.id)))
        logger.info('Deleted message group', { id, count: result.deletedIds.length })
      } catch (err) {
        await rollbackBranch()
        throw err
      }
    },
    [branchWithoutIds, deleteMessageTrigger, rollbackBranch, seedOptimisticBranch, setMessages]
  )

  /** Clear all messages for the current topic from DataApi and UI. */
  const handleClearTopicMessages = useCallback(async () => {
    const rootMsg = projectedMessages.find((m: Message) => !m.askId)
    if (!rootMsg) {
      setMessages([])
      return
    }

    // Empty the branch list optimistically — a cascade delete from the root
    // wipes every message in the topic.
    await writeCache<BranchMessagesResponse>(
      messagesCachePath,
      { items: [], nextCursor: undefined, activeNodeId: null },
      messagesCacheQuery
    )
    setMessages([])

    try {
      await deleteMessageTrigger({ params: { id: rootMsg.id }, query: { cascade: true } })
      logger.info('Cleared all messages via root cascade delete', { topicId: topic.id, rootId: rootMsg.id })
    } catch (err) {
      await rollbackBranch()
      throw err
    }
  }, [
    projectedMessages,
    deleteMessageTrigger,
    messagesCachePath,
    messagesCacheQuery,
    rollbackBranch,
    setMessages,
    topic.id,
    writeCache
  ])

  /** Edit a message's parts directly and persist to DataApi. */
  const handleEditMessage = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      // Overwrite the edited message's `data.parts` in place — the server
      // only replaces the parts array so nothing else in the branch row
      // changes.
      await seedOptimisticBranch((prev) => {
        const patch = (msg: BranchMessagesResponse['items'][number]['message']) =>
          msg.id === messageId ? { ...msg, data: { ...msg.data, parts: editedParts } } : msg
        const items = prev.items.map((item) => ({
          ...item,
          message: patch(item.message),
          siblingsGroup: item.siblingsGroup?.map(patch)
        }))
        return { ...prev, items }
      })
      setMessages((msgs) =>
        msgs.map((m) => (m.id === messageId ? { ...m, parts: editedParts as CherryUIMessage['parts'] } : m))
      )

      try {
        await patchMessageTrigger({ params: { id: messageId }, body: { data: { parts: editedParts } } })
        logger.info('Edited message', { messageId, partCount: editedParts.length })
      } catch (err) {
        await rollbackBranch()
        throw err
      }
    },
    [patchMessageTrigger, rollbackBranch, seedOptimisticBranch, setMessages]
  )

  /**
   * Synchronous capability flags derived from assistant config.
   * `alwaysTagExecution: true` opts this topic's stream into per-execution
   * chunk tagging on Main so every streamed chunk lands in the matching
   * `ExecutionStreamCollector` regardless of single/multi-model. Transport
   * body threads this through to `AiStreamOpenRequest.alwaysTagExecution`.
   */
  const capabilityBody = useMemo(
    () => ({
      knowledgeBaseIds: assistant.knowledge_bases?.map((kb) => kb.id),
      enableWebSearch: assistant.enableWebSearch,
      webSearchProviderId: assistant.webSearchProviderId,
      enableUrlContext: assistant.enableUrlContext,
      enableGenerateImage: assistant.enableGenerateImage,
      alwaysTagExecution: true
    }),
    [
      assistant.knowledge_bases,
      assistant.enableWebSearch,
      assistant.webSearchProviderId,
      assistant.enableUrlContext,
      assistant.enableGenerateImage
    ]
  )

  /** Regenerate with capability body injected. */
  const regenerateWithCapabilities = useCallback(
    async (messageId?: string, options?: { modelId?: UniqueModelId; modelSnapshot?: ModelSnapshot }) => {
      // `mentionedModels: [modelId]` takes the mention-model path on the
      // main side: `resolveModels` prefers the mentioned model over the
      // assistant default, and the single-model regenerate flow creates a
      // new sibling (same user parent, shared siblingsGroupId) so the
      // group renders as a cross-model comparison.
      //
      // `parentAnchorId` is resolved from `uiMessages` — the target's own
      // DB `parentId`. Without this, `IpcChatTransport` falls back to
      // `state.messages.at(-1).id` after AI SDK's truncate, which in a
      // multi-model fan-out leaves a *sibling* as the last message (AI
      // SDK treats the flat array as linear) — Main then parents the new
      // placeholder under that sibling instead of the user message,
      // producing a chain-extension layout bug instead of a sibling.
      const parentAnchorId = messageId
        ? (uiMessages.find((m) => m.id === messageId)?.metadata?.parentId ?? undefined)
        : undefined

      await regenerate({
        messageId,
        body: {
          ...capabilityBody,
          ...(parentAnchorId && { parentAnchorId }),
          ...(options?.modelId && { mentionedModels: [options.modelId] })
        }
      })
    },
    [regenerate, capabilityBody, uiMessages]
  )

  /**
   * Edit + resend as a new branch: create a sibling user message carrying the
   * edited parts (server allocates/shares siblingsGroupId atomically and flips
   * `activeNodeId`), then regenerate the assistant response under the new
   * sibling. Leaves the original user message and its subtree intact.
   */
  const handleForkAndResend = useCallback(
    async (messageId: string, editedParts: CherryMessagePart[]) => {
      const newMessage = await createSiblingTrigger({
        params: { id: messageId },
        body: { parts: editedParts }
      })
      // Sync useChat's internal state from DB before regenerate — AI SDK
      // looks up `newMessage.id` in its messages array, and the fresh
      // sibling was just inserted server-side. The server already flipped
      // `activeNodeId` to the new branch inside the same transaction, so
      // a refresh lands exactly the path we want before we kick off the
      // regeneration.
      const refreshed = await refresh()
      setMessages(refreshed)
      logger.info('Forked user message', { sourceId: messageId, newId: newMessage.id })
      await regenerateWithCapabilities(newMessage.id)
    },
    [createSiblingTrigger, refresh, setMessages, regenerateWithCapabilities]
  )

  const handleSetActiveNode = useCallback(
    async (messageId: string, options?: { descend?: boolean }) => {
      try {
        await setActiveNodeTrigger({
          params: { id: topic.id },
          body: { nodeId: messageId, ...(options?.descend !== undefined && { descend: options.descend }) }
        })
      } catch (err) {
        // NOT_FOUND typically means the message is still being persisted
        // on Main (optimistic push in the renderer racing ahead of the
        // `pending` event). Swallow it with a visible hint instead of
        // surfacing a raw server error — the `isProcessing` gate on
        // MessageMenubar should already suppress the entry point, so this
        // is defensive.
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveNode on unpersisted message', { messageId, topicId: topic.id })
          window.toast.warning('Message is still syncing — try again in a moment')
          return
        }
        throw err
      }
      // useChat owns its own messages state — SWR invalidation refreshes the
      // branch response but doesn't reach into the chat instance. Pull the
      // new active branch and replace so the messages pane reflects the
      // switched branch.
      const refreshed = await refresh()
      setMessages(refreshed)
    },
    [setActiveNodeTrigger, topic.id, refresh, setMessages]
  )

  const v2ChatOverrides = useMemo<V2ChatOverrides>(
    () => ({
      regenerate: async (messageId, options) => regenerateWithCapabilities(messageId, options),
      resend: async (messageId) => regenerateWithCapabilities(messageId),
      deleteMessage: handleDeleteMessage,
      deleteMessageGroup: handleDeleteMessageGroup,
      pause: stop,
      clearTopicMessages: handleClearTopicMessages,
      editMessage: handleEditMessage,
      forkAndResend: handleForkAndResend,
      setActiveNode: handleSetActiveNode,
      refresh
    }),
    [
      regenerateWithCapabilities,
      handleDeleteMessage,
      handleDeleteMessageGroup,
      stop,
      handleClearTopicMessages,
      handleEditMessage,
      handleForkAndResend,
      handleSetActiveNode,
      refresh
    ]
  )

  const handleSendV2 = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => {
      // Main allocates all message ids (user + placeholder(s)) in the
      // reservation transaction. The renderer's `useChat` state may race
      // ahead of Main with its own ids during streaming — `refresh` on
      // stream-done replaces state with the DB snapshot to reconcile.
      await sendMessage(
        { text },
        {
          body: {
            parentAnchorId: activeNodeId ?? undefined,
            files: options?.files,
            mentionedModels: options?.mentionedModels,
            ...capabilityBody
          }
        }
      )
    },
    [activeNodeId, sendMessage, capabilityBody]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <PartsProvider value={mergedPartsMap}>
            <ToolApprovalProvider value={respondToToolApproval}>
              <ChatContextBridge topic={topic}>
                <div
                  className="flex flex-1 flex-col justify-between"
                  style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                  {isDev && (
                    <div
                      className="fixed top-5 right-50 z-50 px-4 py-1 text-xs opacity-50"
                      style={{ color: 'var(--color-text-3)' }}>
                      [V2] {projectedMessages.length} msgs
                      {error && <span className="ml-2 text-red-500">{error.message}</span>}
                    </div>
                  )}

                  {activeExecutionIds.map((executionId) => (
                    <ExecutionStreamCollector
                      key={executionId}
                      topicId={topic.id}
                      executionId={executionId}
                      onMessagesChange={handleExecutionMessagesChange}
                      onDispose={handleExecutionDispose}
                    />
                  ))}

                  <Messages key={topic.id} assistant={assistant} topic={topic} messages={projectedMessages} />

                  <Inputbar assistant={assistant} topic={topic} setActiveTopic={setActiveTopic} onSend={handleSendV2} />
                </div>
              </ChatContextBridge>
            </ToolApprovalProvider>
          </PartsProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </V2ChatOverridesProvider>
  )
}

/**
 * Bridge component rendered INSIDE V2ChatOverridesProvider + PartsProvider
 * so that useChatContextProvider can access those contexts.
 */
const ChatContextBridge: FC<{ topic: Topic; children: ReactNode }> = ({ topic, children }) => {
  const chatContextValue = useChatContextProvider(topic)
  return (
    <ChatContextProvider value={chatContextValue}>
      {children}
      {chatContextValue.isMultiSelectMode && <MultiSelectActionPopup topic={topic} />}
    </ChatContextProvider>
  )
}

export default V2ChatContent
