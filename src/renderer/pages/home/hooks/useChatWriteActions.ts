/**
 * Build the `ChatWriteActions` bag passed down through context.
 *
 * Everything here is a write-side handler (delete / edit / regenerate /
 * resend / fork / setActiveNode / clearTopic) that:
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
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { Topic } from '@renderer/types'
import { resolveUniqueModelId } from '@renderer/utils/message/modelIdentity'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type {
  BranchMessagesResponse,
  CherryUIMessage,
  Message as DbMessage,
  ModelSnapshot
} from '@shared/data/types/message'
import { type UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions } from 'ai'
import { useCallback, useMemo } from 'react'

import type { useTopicMessagesCache } from './useTopicMessagesCache'

const logger = loggerService.withContext('useChatWriteActions')

function getDirectAssistantModelIds(messages: CherryUIMessage[], userMessageId: string): UniqueModelId[] {
  const modelIds = new Set<UniqueModelId>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.metadata?.parentId !== userMessageId) continue

    const modelId = resolveUniqueModelId(message.metadata?.modelId, message.metadata?.modelSnapshot)
    if (modelId) modelIds.add(modelId)
  }

  return Array.from(modelIds)
}

interface Params {
  topic: Topic
  uiMessages: CherryUIMessage[]
  /** Topic's virtual-root id — authoritative first-turn signal (parentId === rootId). */
  rootId: string | null
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  stop: () => Promise<void>
  refresh: () => Promise<CherryUIMessage[]>
  cache: ReturnType<typeof useTopicMessagesCache>
  seedReservedMessages: (messages: CherryUIMessage[]) => Promise<void>
}

interface Result {
  actions: ChatWriteActions
  /** Capability flags the send path needs to mirror — exposed so
   *  `handleSend` builds the same body shape. */
  capabilityBody: Record<string, unknown>
}

export function useChatWriteActions(params: Params): Result {
  const { topic, uiMessages, rootId, regenerate, setMessages, stop, refresh, cache, seedReservedMessages } = params
  const { assistant } = useAssistant(topic.assistantId)
  const {
    branchWithoutIds,
    seedOptimisticBranch,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger,
    clearTopicMessagesTrigger
  } = cache

  // A message is a "first turn" iff its parent IS the topic's virtual root — compared against
  // the authoritative rootId (pagination-independent; the "parent not loaded" proxy
  // misclassified the topmost-paged message). Unknown rootId ⇒ nothing is a first turn.
  const isFirstTurnId = useCallback((parentId?: string | null) => rootId != null && parentId === rootId, [rootId])

  const handleClearTopicMessages = useCallback(async () => {
    await clearBranchCache()
    try {
      const result = await clearTopicMessagesTrigger({ params: { topicId: topic.id } })
      logger.info('Cleared all messages', { topicId: topic.id, count: result.deletedIds.length })
    } catch (err) {
      await rollbackBranch()
      throw err
    }
  }, [clearBranchCache, clearTopicMessagesTrigger, rollbackBranch, topic.id])

  const handleDeleteMessage = useCallback<ChatWriteActions['deleteMessage']>(
    async (id) => {
      // Deleting a first-turn message cascades (remove the turn): a non-cascade splice would
      // reparent its replies onto the virtual root, stranding them as parent-less assistants.
      const target = uiMessages.find((m) => m.id === id)
      const optimisticIds = new Set([id])
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, optimisticIds))

      try {
        if (target && isFirstTurnId(target.metadata?.parentId)) {
          const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
          await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set(result.deletedIds)))
        } else {
          await deleteMessageTrigger({ params: { id }, query: { cascade: false } })
        }
      } catch (err: unknown) {
        await rollbackBranch()
        throw err
      }
      logger.info('Deleted message', { id })
    },
    [branchWithoutIds, deleteMessageTrigger, isFirstTurnId, uiMessages, rollbackBranch, seedOptimisticBranch]
  )

  const handleDeleteMessageGroup = useCallback<ChatWriteActions['deleteMessageGroup']>(
    async (id: string) => {
      // `id` is the group's askId (shared parent). For a first-turn group it is the virtual
      // root, which cannot be deleted — deleting that group means clearing the topic.
      if (isFirstTurnId(id)) {
        await handleClearTopicMessages()
        return
      }
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set([id])))
      try {
        const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
        const deletedSet = new Set(result.deletedIds)
        await seedOptimisticBranch((prev) => branchWithoutIds(prev, deletedSet))
        logger.info('Deleted message group', { id, count: result.deletedIds.length })
      } catch (err) {
        await rollbackBranch()
        throw err
      }
    },
    [
      branchWithoutIds,
      deleteMessageTrigger,
      handleClearTopicMessages,
      isFirstTurnId,
      rollbackBranch,
      seedOptimisticBranch
    ]
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
      knowledgeBaseIds: assistant?.knowledgeBaseIds,
      enableWebSearch: assistant?.settings.enableWebSearch
    }),
    [assistant?.knowledgeBaseIds, assistant?.settings.enableWebSearch]
  )

  /** Regenerate with capability body + target-driven anchor/model. */
  const regenerateWithCapabilities = useCallback(
    async (messageId?: string, options?: { modelId?: UniqueModelId; modelSnapshot?: ModelSnapshot }) => {
      // Anchor semantics depend on the target role:
      //   - assistant: keep parent user intact, spawn sibling — anchor = parentId
      //   - user:      keep the user itself, spawn assistant child — anchor = target.id
      // `mentionedModels`: plain retry on an assistant uses the target's
      // own model (otherwise retrying kimi would produce a gemini reply
      // when assistant default is gemini). User resend picks the default.
      const target = messageId ? uiMessages.find((m) => m.id === messageId) : undefined
      const parentAnchorId = target
        ? target.role === 'user'
          ? target.id
          : (target.metadata?.parentId ?? undefined)
        : undefined
      const regenModelId =
        target?.role === 'assistant'
          ? (options?.modelId ?? (target.metadata?.modelId as UniqueModelId | undefined))
          : options?.modelId

      // PR 3: hydrate `useChat.state.messages` with the current DB-fresh
      // snapshot synchronously, right before the AI SDK's regenerate uses it
      // to splice the new branch. The old `useEffect`-driven sync in
      // useChatRuntimeState was the user's banned anti-pattern; this is the
      // single producer that genuinely needs the hydration, so the snapshot
      // lives at the call site.
      setMessages(uiMessages)

      await regenerate({
        messageId,
        body: {
          ...capabilityBody,
          ...(parentAnchorId && { parentAnchorId }),
          ...(regenModelId && { mentionedModels: [regenModelId] })
        }
      })
    },
    [regenerate, capabilityBody, uiMessages, setMessages]
  )

  const handleForkAndResend = useCallback<ChatWriteActions['forkAndResend']>(
    async (messageId, editedParts) => {
      const inheritedModelIds = getDirectAssistantModelIds(uiMessages, messageId)
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

      // Bypass `regenerateWithCapabilities` here: its `uiMessages`
      // closure is still the pre-fork snapshot in this microtask (the
      // outer ChatContent hasn't re-rendered with the refreshed SWR
      // data yet), so the anchor lookup would miss the new user. We
      // already know the anchor is the new user's own id.
      const ack = await window.api.ai.streamOpen({
        trigger: 'regenerate-message',
        topicId: topic.id,
        parentAnchorId: newMessage.id,
        ...(inheritedModelIds.length > 1 && { mentionedModelIds: inheritedModelIds })
      })

      if (ack.mode === 'blocked') {
        throw new Error(ack.message)
      }

      await seedReservedMessages(ack.reservedMessages ?? [])
    },
    [createSiblingTrigger, seedReservedMessages, refresh, setMessages, topic.id, uiMessages]
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
      const ack = await window.api.ai.streamOpen({
        trigger: 'regenerate-message',
        topicId: topic.id,
        parentAnchorId,
        ...(modelId && { mentionedModelIds: [modelId] })
      })

      if (ack.mode === 'blocked') {
        throw new Error(ack.message)
      }

      await seedReservedMessages(ack.reservedMessages ?? [])
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
          window.toast.warning('Message is still syncing — try again in a moment')
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
          window.toast.warning('Message is still syncing — try again in a moment')
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

  const actions = useMemo<ChatWriteActions>(
    () => ({
      regenerate: async (messageId, options) => regenerateWithCapabilities(messageId, options),
      resend: handleResend,
      deleteMessage: handleDeleteMessage,
      deleteMessageGroup: handleDeleteMessageGroup,
      pause: stop,
      clearTopicMessages: handleClearTopicMessages,
      editMessage: handleEditMessage,
      forkAndResend: handleForkAndResend,
      setActiveNode: handleSetActiveNode,
      setActiveBranch: handleSetActiveBranch,
      refresh
    }),
    [
      regenerateWithCapabilities,
      handleResend,
      handleDeleteMessage,
      handleDeleteMessageGroup,
      stop,
      handleClearTopicMessages,
      handleEditMessage,
      handleForkAndResend,
      handleSetActiveNode,
      handleSetActiveBranch,
      refresh
    ]
  )

  return { actions, capabilityBody }
}
