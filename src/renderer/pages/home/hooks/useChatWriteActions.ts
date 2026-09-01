import type { ChatRequestOptions } from 'ai'
import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Build the `ChatWriteActions` bag passed down through context.
 *
 * Everything here is a write-side handler (delete / edit / regenerate /
 * resend / fork / setActiveNode) that:
 *   1. seeds the optimistic branch-response cache and/or mutates
 *      `useChat.state.messages`,
 *   2. fires the DataApi mutation trigger (from `useBranchCacheOps`),
 *   3. rolls back on error.
 *
 * Shape / semantics match `ChatWriteContext.ChatWriteActions` one-to-one —
 * this file exists to get the ~300 lines of handler code out of
 * `ChatContent.tsx`, not to change behaviour.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { ChatWriteActions } from '@renderer/hooks/chat/ChatWriteContext'
import type { ReservedMessageSeedOptions } from '@renderer/hooks/useConversationTurnController'
import { ipcApi } from '@renderer/ipc'
import { getStreamBlockedMessage } from '@renderer/services/aiTransport'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import { resolveUniqueModelId } from '@renderer/utils/message/modelIdentity'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type {
  AssistantTurnOptions,
  BranchMessagesResponse,
  CherryUIMessage,
  Message as DbMessage
} from '@shared/data/types/message'
import { type UniqueModelId } from '@shared/data/types/model'
import { createClearContextPart, hasClearContextPart } from '@shared/data/types/uiParts'

import type { useTopicMessagesCache } from './useTopicMessagesCache'

const logger = loggerService.withContext('useChatWriteActions')

function getDirectAssistantModelIds(messages: CherryUIMessage[], userMessageId: string): UniqueModelId[] {
  const modelIds = new Set<UniqueModelId>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.metadata?.parentId !== userMessageId) continue

    const snapshot = message.metadata?.messageSnapshot
    const model = snapshot?.model
    const modelId = resolveUniqueModelId(message.metadata?.modelId, model)
    if (modelId) modelIds.add(modelId)
  }

  return Array.from(modelIds)
}

function getInheritedTurnOptions(
  messages: CherryUIMessage[],
  target: CherryUIMessage | undefined
): AssistantTurnOptions | undefined {
  if (!target) return undefined
  if (target.role === 'assistant') return target.metadata?.turnOptions

  const directAssistants = messages.filter(
    (message) => message.role === 'assistant' && message.metadata?.parentId === target.id
  )
  const source = directAssistants.find((message) => message.metadata?.isActiveBranch) ?? directAssistants.at(-1)
  return source?.metadata?.turnOptions
}

function turnOptionsRequestFields(turnOptions: AssistantTurnOptions | undefined): AssistantTurnOptions {
  return {
    ...(turnOptions?.reasoningEffort !== undefined && { reasoningEffort: turnOptions.reasoningEffort }),
    ...(turnOptions?.serviceTier !== undefined && { serviceTier: turnOptions.serviceTier }),
    ...(turnOptions?.fastMode !== undefined && { fastMode: turnOptions.fastMode })
  }
}

interface Params {
  topic: Topic
  uiMessages: CherryUIMessage[]
  activeNodeId: string | null
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  stop: () => Promise<void>
  refresh: () => Promise<CherryUIMessage[]>
  cache: ReturnType<typeof useTopicMessagesCache>
  seedReservedMessages: (messages: CherryUIMessage[], options?: ReservedMessageSeedOptions) => Promise<void>
  scrollToBottom: () => void
  startNewContextBlocked: boolean
  assistant?: Assistant
}

interface Result {
  actions: ChatWriteActions
  /** Capability flags the send path needs to mirror — exposed so
   *  `handleSend` builds the same body shape. */
  capabilityBody: Record<string, unknown>
}

export function useChatWriteActions(params: Params): Result {
  const {
    topic,
    uiMessages,
    activeNodeId,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache,
    seedReservedMessages,
    scrollToBottom,
    startNewContextBlocked,
    assistant
  } = params
  const {
    branchWithoutIds,
    seedOptimisticBranch,
    seedReservedMessages: seedMessagesCache,
    rollbackBranch,
    deleteMessageTrigger,
    deleteMessageGroupTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    createMessageTrigger,
    setActiveNodeTrigger
  } = cache
  const startNewContextPromiseRef = useRef<Promise<void> | null>(null)
  const [isStartingNewContext, setIsStartingNewContext] = useState(false)

  const handleStartNewContext = useCallback<ChatWriteActions['startNewContext']>(() => {
    if (startNewContextPromiseRef.current) {
      return startNewContextPromiseRef.current
    }
    if (!activeNodeId || startNewContextBlocked) {
      return Promise.resolve()
    }

    setIsStartingNewContext(true)
    const operation = (async () => {
      const activeMessage = uiMessages.find((message) => message.id === activeNodeId)
      if (hasClearContextPart(activeMessage?.parts)) {
        await seedOptimisticBranch((items) => branchWithoutIds(items, new Set([activeNodeId])))
        try {
          await deleteMessageTrigger({ params: { id: activeNodeId }, query: { cascade: false } })
          logger.info('Removed context boundary', { messageId: activeNodeId, topicId: topic.id })
        } catch (error) {
          await rollbackBranch()
          throw error
        }
      } else {
        try {
          const message = await createMessageTrigger({
            params: { topicId: topic.id },
            body: {
              parentId: activeNodeId,
              role: 'user',
              status: 'success',
              data: { parts: [createClearContextPart()] }
            }
          })
          await seedMessagesCache([sharedMessageToUIMessage(message)])
          logger.info('Created context boundary', { messageId: message.id, topicId: topic.id })
        } catch (error) {
          await rollbackBranch()
          throw error
        }
      }

      scrollToBottom()
    })()

    const trackedOperation = operation.finally(() => {
      if (startNewContextPromiseRef.current === trackedOperation) {
        startNewContextPromiseRef.current = null
        setIsStartingNewContext(false)
      }
    })
    startNewContextPromiseRef.current = trackedOperation
    return trackedOperation
  }, [
    activeNodeId,
    branchWithoutIds,
    createMessageTrigger,
    deleteMessageTrigger,
    rollbackBranch,
    scrollToBottom,
    seedMessagesCache,
    seedOptimisticBranch,
    startNewContextBlocked,
    topic.id,
    uiMessages
  ])
  const canStartNewContext = Boolean(activeNodeId) && !startNewContextBlocked && !isStartingNewContext

  const getMessageDeleteAvailability = useCallback<ChatWriteActions['getMessageDeleteAvailability']>(
    (id: string) => {
      const message = uiMessages.find((item) => item.id === id)
      if (!message) return { enabled: false, reason: 'not-loaded' }
      if (message.role === 'assistant' && message.metadata?.status === 'pending') {
        return { enabled: false, reason: 'generating' }
      }
      return { enabled: true }
    },
    [uiMessages]
  )

  const handleDeleteMessage = useCallback<ChatWriteActions['deleteMessage']>(
    async (id, options) => {
      // Reject unloaded targets before the first optimistic or persistent write. First-turn
      // messages follow the same splice path as every other message; the backend reparents their
      // children onto the topic's virtual root.
      const selectionContainsUnavailableMessage = options?.selectedMessageIds?.some((messageId) => {
        return !getMessageDeleteAvailability(messageId).enabled
      })
      if (!getMessageDeleteAvailability(id).enabled || selectionContainsUnavailableMessage) {
        throw new Error('Message deletion is unavailable')
      }

      const optimisticIds = new Set([id])
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, optimisticIds))

      try {
        await deleteMessageTrigger({ params: { id }, query: { cascade: false } })
        invalidateCachedMessageUiStates([id])
      } catch (err: unknown) {
        await rollbackBranch()
        throw err
      }
      logger.info('Deleted message', { id })
    },
    [branchWithoutIds, deleteMessageTrigger, getMessageDeleteAvailability, rollbackBranch, seedOptimisticBranch]
  )

  const handleDeleteMessageGroup = useCallback<ChatWriteActions['deleteMessageGroup']>(
    async (messageIds) => {
      const uniqueMessageIds = Array.from(new Set(messageIds))
      if (
        uniqueMessageIds.length === 0 ||
        uniqueMessageIds.some((messageId) => !getMessageDeleteAvailability(messageId).enabled)
      ) {
        throw new Error('Message group deletion is unavailable')
      }
      // Optimistically remove only the rendered representatives. The service resolves the
      // complete sibling group inside its transaction and returns the authoritative ids.
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set(uniqueMessageIds)))
      try {
        const result = await deleteMessageGroupTrigger({ params: { id: uniqueMessageIds[0] } })
        await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set(result.deletedIds)))
        invalidateCachedMessageUiStates(result.deletedIds)
        logger.info('Deleted message group', { count: result.deletedIds.length })
      } catch (err) {
        await rollbackBranch()
        throw err
      }
    },
    [branchWithoutIds, deleteMessageGroupTrigger, getMessageDeleteAvailability, rollbackBranch, seedOptimisticBranch]
  )

  const handleEditMessage = useCallback<ChatWriteActions['editMessage']>(
    async (messageId, editedParts) => {
      await seedOptimisticBranch((items) => {
        const patch = (msg: BranchMessagesResponse['items'][number]['message']) =>
          msg.id === messageId ? { ...msg, data: { ...msg.data, parts: editedParts } } : msg
        return items.map((item) => ({
          ...item,
          message: patch(item.message),
          siblingsGroup: item.siblingsGroup?.map(patch)
        }))
      })
      try {
        await patchMessageTrigger({ params: { id: messageId }, body: { data: { parts: editedParts } } })
        logger.info('Edited message', { messageId, partCount: editedParts.length })
      } catch (err) {
        await rollbackBranch()
        throw err
      }
    },
    [patchMessageTrigger, rollbackBranch, seedOptimisticBranch]
  )

  const capabilityBody = useMemo<Record<string, unknown>>(
    () => ({
      enableWebSearch: assistant?.settings.enableWebSearch
    }),
    [assistant?.settings.enableWebSearch]
  )

  /** Regenerate with capability body + target-driven anchor/model. */
  const regenerateWithCapabilities = useCallback(
    async (messageId?: string, options?: { modelId?: UniqueModelId; turnOptions?: AssistantTurnOptions }) => {
      // Anchor semantics depend on the target role:
      //   - assistant: keep parent user intact, spawn sibling — anchor = parentId
      //   - user:      keep the user itself, spawn assistant child — anchor = target.id
      // Ordinary regeneration leaves the model unspecified so Main observes the current default.
      // Failed in-place retries keep their original model; an explicit model always wins.
      const target = messageId ? uiMessages.find((m) => m.id === messageId) : undefined
      const parentAnchorId = target
        ? target.role === 'user'
          ? target.id
          : (target.metadata?.parentId ?? undefined)
        : undefined
      const regenerateModelId = options?.modelId
      const retryModelId =
        target?.role === 'assistant'
          ? (regenerateModelId ?? (target.metadata?.modelId as UniqueModelId | undefined))
          : regenerateModelId
      const turnOptions = options?.turnOptions ?? getInheritedTurnOptions(uiMessages, target)
      const targetStatus = target?.metadata?.status
      const isFailedAssistant =
        target?.role === 'assistant' &&
        targetStatus !== 'pending' &&
        (targetStatus === 'error' || targetStatus === 'paused' || (target.parts?.length ?? 0) === 0)
      const canRetryInPlace =
        isFailedAssistant &&
        parentAnchorId !== undefined &&
        retryModelId !== undefined &&
        (options?.modelId === undefined || options.modelId === target.metadata?.modelId)

      if (canRetryInPlace) {
        const ack = await ipcApi.request('ai.stream.open', {
          trigger: 'regenerate-message',
          topicId: topic.id,
          parentAnchorId,
          retryMessageId: target.id,
          mentionedModelIds: [retryModelId],
          ...turnOptionsRequestFields(turnOptions)
        })
        if (ack.mode === 'blocked') throw new Error(getStreamBlockedMessage(ack))
        await seedReservedMessages(ack.reservedMessages ?? [], {
          activeExecutions: ack.activeExecutions,
          preserveActiveNode: ack.preserveActiveNode
        })
        return
      }

      // The message toolbar's @ picker is an explicit request to add the selected model to this
      // reply group. Main decides atomically whether the group is still live: live groups append a
      // new execution without moving activeNodeId; settled groups use the ordinary regenerate path.
      if (target?.role === 'assistant' && parentAnchorId && options?.modelId) {
        const ack = await ipcApi.request('ai.stream.open', {
          trigger: 'regenerate-message',
          topicId: topic.id,
          parentAnchorId,
          appendToLiveGroupMessageId: target.id,
          mentionedModelIds: [options.modelId],
          ...turnOptionsRequestFields(turnOptions)
        })
        if (ack.mode === 'blocked') throw new Error(getStreamBlockedMessage(ack))
        await seedReservedMessages(ack.reservedMessages ?? [], {
          activeExecutions: ack.activeExecutions,
          preserveActiveNode: ack.preserveActiveNode
        })
        return
      }

      // PR 3: hydrate `useChat.state.messages` with the current DB-fresh
      // snapshot synchronously, right before the AI SDK's regenerate uses it
      // to splice the new branch. The old `useEffect`-driven sync in
      // useChatRuntimeState was the user's banned anti-pattern; this is the
      // single producer that genuinely needs the hydration, so the snapshot
      // lives at the call site.
      setMessages(uiMessages)

      const regeneratePromise = regenerate({
        messageId,
        body: {
          ...capabilityBody,
          ...(parentAnchorId && { parentAnchorId }),
          ...(regenerateModelId && { mentionedModels: [regenerateModelId] }),
          ...turnOptionsRequestFields(turnOptions)
        }
      })
      await regeneratePromise
    },
    [regenerate, capabilityBody, uiMessages, setMessages, seedReservedMessages, topic.id]
  )

  const handleForkAndResend = useCallback<ChatWriteActions['forkAndResend']>(
    async (messageId, editedParts, turnOptions) => {
      const inheritedModelIds = getDirectAssistantModelIds(uiMessages, messageId)
      const sourceMessage = uiMessages.find((message) => message.id === messageId)
      const effectiveTurnOptions = turnOptions ?? getInheritedTurnOptions(uiMessages, sourceMessage)
      const newMessage = await createSiblingTrigger({
        params: { id: messageId },
        body: { parts: editedParts }
      })
      await seedReservedMessages([
        {
          id: newMessage.id,
          role: 'user',
          parts: editedParts,
          metadata: {
            parentId: newMessage.parentId,
            siblingsGroupId: newMessage.siblingsGroupId ?? undefined,
            status: newMessage.status,
            createdAt: newMessage.createdAt
          }
        } as CherryUIMessage
      ])
      // Sync `useChat` from DB before regenerate. The server flipped
      // `activeNodeId` to the new branch in the same transaction.
      const refreshed = await refresh()
      setMessages(refreshed)
      logger.info('Forked user message', { sourceId: messageId, newId: newMessage.id })
      const shouldPreserveInheritedModelIds =
        inheritedModelIds.length > 1 || (!topic.assistantId && inheritedModelIds.length === 1)

      // Bypass `regenerateWithCapabilities` here: its `uiMessages`
      // closure is still the pre-fork snapshot in this microtask (the
      // outer ChatContent hasn't re-rendered with the refreshed SWR
      // data yet), so the anchor lookup would miss the new user. We
      // already know the anchor is the new user's own id.
      const ack = await ipcApi.request('ai.stream.open', {
        trigger: 'regenerate-message',
        topicId: topic.id,
        parentAnchorId: newMessage.id,
        ...(shouldPreserveInheritedModelIds && { mentionedModelIds: inheritedModelIds }),
        ...turnOptionsRequestFields(effectiveTurnOptions)
      })

      if (ack.mode === 'blocked') {
        throw new Error(getStreamBlockedMessage(ack))
      }

      await seedReservedMessages(ack.reservedMessages ?? [], {
        activeExecutions: ack.activeExecutions,
        preserveActiveNode: ack.preserveActiveNode
      })
    },
    [createSiblingTrigger, seedReservedMessages, refresh, setMessages, topic.id, topic.assistantId, uiMessages]
  )

  const handleResend = useCallback<ChatWriteActions['resend']>(
    async (messageId) => {
      const target = messageId ? uiMessages.find((m) => m.id === messageId) : undefined
      const parentAnchorId = target
        ? target.role === 'user'
          ? target.id
          : (target.metadata?.parentId ?? undefined)
        : undefined

      if (!parentAnchorId) {
        await regenerateWithCapabilities(messageId)
        return
      }

      const modelId = target?.role === 'assistant' ? (target.metadata?.modelId as UniqueModelId | undefined) : undefined
      const turnOptions = getInheritedTurnOptions(uiMessages, target)
      const ack = await ipcApi.request('ai.stream.open', {
        trigger: 'regenerate-message',
        topicId: topic.id,
        parentAnchorId,
        ...(modelId && { mentionedModelIds: [modelId] }),
        ...turnOptionsRequestFields(turnOptions)
      })

      if (ack.mode === 'blocked') {
        throw new Error(getStreamBlockedMessage(ack))
      }

      await seedReservedMessages(ack.reservedMessages ?? [], {
        activeExecutions: ack.activeExecutions,
        preserveActiveNode: ack.preserveActiveNode
      })
    },
    [regenerateWithCapabilities, seedReservedMessages, topic.id, uiMessages]
  )

  const handleSetActiveNode = useCallback<ChatWriteActions['setActiveNode']>(
    async (messageId) => {
      try {
        await setActiveNodeTrigger({
          params: { id: topic.id },
          body: { nodeId: messageId }
        })
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveNode on unpersisted message', { messageId, topicId: topic.id })
          toast.warning('Message is still syncing — try again in a moment')
          return
        }
        throw err
      }
    },
    [setActiveNodeTrigger, topic.id]
  )

  const handleSetActiveBranch = useCallback<ChatWriteActions['setActiveBranch']>(
    async (throughNodeId) => {
      let leafId = throughNodeId
      try {
        const path = (await dataApiService.get(`/topics/${topic.id}/path`, {
          query: { nodeId: throughNodeId }
        })) as DbMessage[]
        if (path.length > 0) {
          leafId = path[path.length - 1].id
        }
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch on unpersisted message', { throughNodeId, topicId: topic.id })
          toast.warning('Message is still syncing — try again in a moment')
          return
        }
        throw err
      }
      try {
        await setActiveNodeTrigger({ params: { id: topic.id }, body: { nodeId: leafId } })
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch leaf vanished mid-flight', { leafId, topicId: topic.id })
          return
        }
        throw err
      }
    },
    [setActiveNodeTrigger, topic.id]
  )

  const handlePause = useCallback<ChatWriteActions['pause']>(() => {
    void stop().catch((error) => {
      logger.error('Failed to pause chat stream', { topicId: topic.id, error })
    })
  }, [stop, topic.id])

  const actions = useMemo<ChatWriteActions>(
    () => ({
      canStartNewContext,
      startNewContext: handleStartNewContext,
      regenerate: async (messageId, options) => regenerateWithCapabilities(messageId, options),
      resend: handleResend,
      getMessageDeleteAvailability,
      deleteMessage: handleDeleteMessage,
      deleteMessageGroup: handleDeleteMessageGroup,
      pause: handlePause,
      editMessage: handleEditMessage,
      forkAndResend: handleForkAndResend,
      setActiveNode: handleSetActiveNode,
      setActiveBranch: handleSetActiveBranch,
      refresh
    }),
    [
      canStartNewContext,
      regenerateWithCapabilities,
      handleStartNewContext,
      handleResend,
      getMessageDeleteAvailability,
      handleDeleteMessage,
      handleDeleteMessageGroup,
      handlePause,
      handleEditMessage,
      handleForkAndResend,
      handleSetActiveNode,
      handleSetActiveBranch,
      refresh
    ]
  )

  return { actions, capabilityBody }
}
