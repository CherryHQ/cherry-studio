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
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type {
  BranchMessagesResponse,
  CherryMessagePart,
  CherryUIMessage,
  ModelSnapshot
} from '@shared/data/types/message'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, RefreshProvider } from './Messages/Blocks'
import ExecutionStreamCollector from './Messages/ExecutionStreamCollector'
import Messages from './Messages/Messages'

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
  initialMessages: CherryUIMessage[]
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
  siblingsMap,
  refresh,
  activeNodeId
}) => {
  // const { isMultiSelectMode } = useChatContext(topic)

  const {
    adaptedMessages,
    partsMap,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    streamingUIMessages,
    activeExecutionIds,
    prepareNextAssistantId,
    addToolApprovalResponse
  } = useChatWithHistory(topic.id, initialMessages, refresh, { assistantId: assistant.id })

  /**
   * Align the three assistant-id producers for a single-execution turn so
   * `useChat.activeResponse`, the chunks coming off the stream, and the DB
   * placeholder row all agree on one UUID:
   *   1. `prepareNextAssistantId` queues the id for the next
   *      `Chat.generateId()` call (consumed inside `Chat.makeRequest` when it
   *      seeds `activeResponse.state.message.id`).
   *   2. Returned id goes into `body.assistantMessageId`, which the main-side
   *      `reserveAssistantTurn` honours as the placeholder row's `id`.
   *
   * Without this alignment, AI SDK falls back to `pushMessage` on the first
   * chunk (it sees an unknown id and assumes a brand-new message), producing
   * two duplicate assistant bubbles — the silent orphan from `activeResponse`
   * and the real one receiving chunks. Multi-model turns skip this entirely:
   * each execution gets its own id on Main, so there's nothing to align on
   * the renderer side.
   */
  const allocateSingleAssistantId = useCallback(
    (isMultiModel: boolean) => {
      if (isMultiModel) return undefined
      const id = crypto.randomUUID()
      prepareNextAssistantId(id)
      return id
    },
    [prepareNextAssistantId]
  )

  /**
   * Seed an optimistic assistant placeholder into `useChat.state.messages`
   * with the full metadata the renderer needs (modelSnapshot, status,
   * parentId, createdAt). Carrying metadata on the message itself means
   * `MessageHeader` / `ModelAvatar` / `isMessageProcessing` all light up
   * immediately instead of falling back to "D" / "Invalid Date" while
   * `refresh()` catches up. AI SDK's `replaceMessage` on the first chunk
   * keeps the id stable, so the DB refresh that lands later is a quiet
   * overwrite — no flicker.
   */
  const seedAssistantPlaceholder = useCallback(
    (opts: { assistantMessageId: string; modelSnapshot?: ModelSnapshot; parentId?: string | null }): void => {
      const { assistantMessageId, modelSnapshot, parentId } = opts
      const modelId = modelSnapshot ? createUniqueModelId(modelSnapshot.provider, modelSnapshot.id) : undefined
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          parts: [],
          metadata: {
            modelSnapshot,
            modelId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            parentId: parentId ?? undefined
          }
        }
      ])
    },
    [setMessages]
  )

  const respondToToolApproval = useToolApprovalBridge({ addToolApprovalResponse })

  const [executionMessagesById, setExecutionMessagesById] = useState<Record<string, CherryUIMessage[]>>({})
  const executionCreatedAtRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (activeExecutionIds.length === 0) {
      setExecutionMessagesById({})
      executionCreatedAtRef.current = {}
      return
    }

    const activeSet = new Set<string>(activeExecutionIds)
    setExecutionMessagesById((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([executionId]) => activeSet.has(executionId)))
    )
  }, [activeExecutionIds])

  const currentAnchorUserMessageId = useMemo(() => {
    for (let index = streamingUIMessages.length - 1; index >= 0; index--) {
      const message = streamingUIMessages[index]
      if (message.role === 'user') return message.id
    }

    for (let index = adaptedMessages.length - 1; index >= 0; index--) {
      const message = adaptedMessages[index]
      if (message.role === 'user') return message.id
    }

    if (!activeNodeId) return undefined
    // Fall back to the activeNode's own parent from `state.messages`
    // metadata (parentId is persisted on every `CherryUIMessage` via
    // `toUIMessage`). Used when there's no visible user message yet —
    // typically the first frames after opening a topic.
    const activeNode = streamingUIMessages.find((m) => m.id === activeNodeId)
    return activeNode?.metadata?.parentId ?? activeNodeId
  }, [activeNodeId, adaptedMessages, streamingUIMessages])

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
    delete executionCreatedAtRef.current[executionId]
  }, [])

  const executionOverlayMessages = useMemo<Message[]>(() => {
    const overlaidMessages: Message[] = []

    for (const executionId of activeExecutionIds) {
      const messages = executionMessagesById[executionId] ?? []
      for (const uiMessage of messages) {
        if (uiMessage.role !== 'assistant') continue

        const createdAt =
          uiMessage.metadata?.createdAt ??
          executionCreatedAtRef.current[uiMessage.id] ??
          (executionCreatedAtRef.current[uiMessage.id] = new Date().toISOString())

        overlaidMessages.push({
          id: uiMessage.id,
          role: 'assistant',
          assistantId: assistant.id,
          topicId: topic.id,
          createdAt,
          askId: currentAnchorUserMessageId,
          modelId: executionId,
          status:
            status === 'submitted'
              ? AssistantMessageStatus.PENDING
              : status === 'streaming'
                ? AssistantMessageStatus.PROCESSING
                : AssistantMessageStatus.SUCCESS,
          blocks: []
        })
      }
    }

    return overlaidMessages
  }, [activeExecutionIds, assistant.id, currentAnchorUserMessageId, executionMessagesById, status, topic.id])

  // Dedupe by id — `useChat.messages` (via `adaptedMessages`) already
  // surfaces the assistant message for the primary execution during
  // streaming; overlay entries are only there to cover the *other*
  // executions in a multi-model turn. Plain spread duplicated ids and
  // tripped React's "two children with the same key" warning, which in
  // turn caused lists like `MessageAnchorLine` to render twice.
  const mergedMessages = useMemo(() => {
    if (executionOverlayMessages.length === 0) return adaptedMessages
    const adaptedIds = new Set(adaptedMessages.map((m) => m.id))
    return [...adaptedMessages, ...executionOverlayMessages.filter((m) => !adaptedIds.has(m.id))]
  }, [adaptedMessages, executionOverlayMessages])

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const nextPartsMap = { ...partsMap }
    for (const executionId of activeExecutionIds) {
      for (const uiMessage of executionMessagesById[executionId] ?? []) {
        nextPartsMap[uiMessage.id] = uiMessage.parts as CherryMessagePart[]
      }
    }
    return nextPartsMap
  }, [activeExecutionIds, executionMessagesById, partsMap])

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
    const rootMsg = adaptedMessages.find((m: Message) => !m.askId)
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
    adaptedMessages,
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

  /** Synchronous capability flags derived from assistant config. */
  const capabilityBody = useMemo(
    () => ({
      knowledgeBaseIds: assistant.knowledge_bases?.map((kb) => kb.id),
      enableWebSearch: assistant.enableWebSearch,
      webSearchProviderId: assistant.webSearchProviderId,
      enableUrlContext: assistant.enableUrlContext,
      enableGenerateImage: assistant.enableGenerateImage
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
      // `mentionedModels: [modelId]` takes the mention-model path on the main
      // side: `resolveModels` prefers the mentioned model over the assistant
      // default, and the single-model regenerate flow creates a new sibling
      // (same user parent, shared siblingsGroupId) so the group renders as a
      // cross-model comparison.
      //
      // Regenerate is single-execution: allocate a shared assistant id here
      // to keep `useChat.activeResponse` and the DB placeholder on the same
      // UUID. Skipping this step makes AI SDK `pushMessage` on the first
      // chunk (id mismatch) and the old + new assistant bubbles render side
      // by side. Multi-model fan-out is never a regenerate today, so the
      // single-id path always applies.
      const assistantMessageId = allocateSingleAssistantId(false)

      // Inherit the previous assistant's parentId + modelSnapshot for the
      // optimistic placeholder. `messageId` (if provided) is the assistant
      // being regenerated; its metadata carries the right user-message
      // parent and (unless overridden via `options.modelSnapshot`) the same
      // model. For the "regenerate last" path (messageId omitted) we leave
      // both undefined — the upcoming refresh will fill them in.
      const regenTarget = messageId ? streamingUIMessages.find((m) => m.id === messageId) : undefined
      const placeholderSnapshot = options?.modelSnapshot ?? regenTarget?.metadata?.modelSnapshot
      const placeholderParentId = regenTarget?.metadata?.parentId

      await regenerate({
        messageId,
        body: {
          ...capabilityBody,
          assistantMessageId,
          ...(options?.modelId && { mentionedModels: [options.modelId] })
        }
      })

      if (assistantMessageId) {
        seedAssistantPlaceholder({
          assistantMessageId,
          modelSnapshot: placeholderSnapshot,
          parentId: placeholderParentId
        })
      }
    },
    [regenerate, capabilityBody, allocateSingleAssistantId, streamingUIMessages, seedAssistantPlaceholder]
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
      // Single-model only: pre-generate the assistant UUID and align all
      // three consumers on it (useChat.activeResponse, useChat.state.messages
      // after refresh, and the DB placeholder row). Multi-model turns keep
      // the old path — Main allocates N ids and the overlay renderer owns
      // per-execution state via `ExecutionStreamCollector`.
      const isMultiModel = (options?.mentionedModels?.length ?? 0) > 1
      const assistantMessageId = allocateSingleAssistantId(isMultiModel)
      void sendMessage(
        { text },
        {
          body: {
            parentAnchorId: activeNodeId ?? undefined,
            files: options?.files,
            mentionedModels: options?.mentionedModels,
            assistantMessageId,
            ...capabilityBody
          }
        }
      )
      // Append an assistant placeholder so the PENDING indicator + model
      // chrome (avatar, name) show up during the ~20–50ms gap between
      // click and Main's `pending` broadcast. The id matches Main's
      // placeholder row, so the later `refresh` + `setMessages(refreshed)`
      // is an idempotent id-preserving replace.
      //
      // The append must wait ONE microtask: `sendMessage` awaits
      // `convertFileListToFileUIParts` (ai/src/ui/chat.ts:371) before
      // `pushMessage(user)`, even for text-only turns (async function yields
      // once). Appending synchronously lands the placeholder *before* the new
      // user message — `adaptedMessages` then derives its `askId` from the
      // prior turn's user, flashing the placeholder into the previous
      // multi-model siblings group until `pending` refresh repairs the order.
      if (assistantMessageId) {
        const snapshot: ModelSnapshot | undefined = assistant.model
          ? {
              id: assistant.model.id,
              name: assistant.model.name,
              provider: assistant.model.provider,
              ...(assistant.model.group && { group: assistant.model.group })
            }
          : undefined
        queueMicrotask(() => {
          seedAssistantPlaceholder({
            assistantMessageId,
            modelSnapshot: snapshot,
            parentId: activeNodeId ?? null
          })
        })
      }
    },
    [activeNodeId, sendMessage, assistant.model, allocateSingleAssistantId, seedAssistantPlaceholder, capabilityBody]
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
                      [V2] {status} | {mergedMessages.length} msgs
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

                  <Messages key={topic.id} assistant={assistant} topic={topic} messages={mergedMessages} />

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
