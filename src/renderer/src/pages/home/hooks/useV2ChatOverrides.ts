/**
 * Build the `V2ChatOverrides` bag passed down through context.
 *
 * Everything here is a write-side handler (delete / edit / regenerate /
 * resend / fork / setActiveNode / clearTopic) that:
 *   1. seeds the optimistic branch-response cache and/or mutates
 *      `useChat.state.messages`,
 *   2. fires the DataApi mutation trigger (from `useBranchCacheOps`),
 *   3. rolls back on error.
 *
 * Shape / semantics match `V2ChatContext.V2ChatOverrides` one-to-one —
 * this file exists to get the ~300 lines of handler code out of
 * `V2ChatContent.tsx`, not to change behaviour.
 */
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { V2ChatOverrides } from '@renderer/hooks/V2ChatContext'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
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

const logger = loggerService.withContext('useV2ChatOverrides')

interface Params {
  topic: Topic
  uiMessages: CherryUIMessage[]
  projectedMessages: Message[]
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  stop: () => Promise<void>
  refresh: () => Promise<CherryUIMessage[]>
  cache: ReturnType<typeof useTopicMessagesCache>
}

interface Result {
  overrides: V2ChatOverrides
  /** Capability flags the send path needs to mirror — exposed so
   *  `handleSendV2` builds the same body shape. */
  capabilityBody: Record<string, unknown>
}

export function useV2ChatOverrides(params: Params): Result {
  const { topic, uiMessages, projectedMessages, regenerate, setMessages, stop, refresh, cache } = params
  const { assistant } = useAssistant(topic.assistantId)
  const {
    branchWithoutIds,
    seedOptimisticBranch,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger
  } = cache

  /**
   * Pull DB truth back into `useChat.state.messages`. Optimistic mutations
   * (delete/edit/clear) update `state.messages` locally via `setMessages`,
   * but on error rollback they don't auto-revert; and on success the local
   * projection may still drift from the canonical DB row. Calling this at
   * the tail of each handler keeps the primary chat state consistent with
   * what the user sees (which is projected from `uiMessages`).
   */
  const syncChatStateFromDB = useCallback(async () => {
    try {
      const refreshed = await refresh()
      setMessages(refreshed)
    } catch (err) {
      logger.warn('Failed to sync useChat state from DB', { err })
    }
  }, [refresh, setMessages])

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
            await syncChatStateFromDB()
            throw cascadeErr
          }
        } else {
          await rollbackBranch()
          await syncChatStateFromDB()
          throw err
        }
      }
      // Best-effort: drop span-cache history for the turn we just removed.
      void window.api.trace.cleanHistory(topic.id, traceOptions?.traceId ?? '', traceOptions?.modelName)
      await syncChatStateFromDB()
      logger.info('Deleted message', { id })
    },
    [
      branchWithoutIds,
      deleteMessageTrigger,
      rollbackBranch,
      seedOptimisticBranch,
      setMessages,
      syncChatStateFromDB,
      topic.id
    ]
  )

  const handleDeleteMessageGroup = useCallback<V2ChatOverrides['deleteMessageGroup']>(
    async (id: string) => {
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, new Set([id])))
      try {
        const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
        const deletedSet = new Set(result.deletedIds)
        await seedOptimisticBranch((prev) => branchWithoutIds(prev, deletedSet))
        setMessages((msgs) => msgs.filter((m) => !deletedSet.has(m.id)))
        logger.info('Deleted message group', { id, count: result.deletedIds.length })
      } catch (err) {
        await rollbackBranch()
        await syncChatStateFromDB()
        throw err
      }
      await syncChatStateFromDB()
    },
    [branchWithoutIds, deleteMessageTrigger, rollbackBranch, seedOptimisticBranch, setMessages, syncChatStateFromDB]
  )

  const handleClearTopicMessages = useCallback(async () => {
    const rootMsg = projectedMessages.find((m: Message) => !m.askId)
    if (!rootMsg) {
      setMessages([])
      return
    }
    await clearBranchCache()
    setMessages([])
    try {
      await deleteMessageTrigger({ params: { id: rootMsg.id }, query: { cascade: true } })
      logger.info('Cleared all messages via root cascade delete', { topicId: topic.id, rootId: rootMsg.id })
    } catch (err) {
      await rollbackBranch()
      await syncChatStateFromDB()
      throw err
    }
    await syncChatStateFromDB()
  }, [
    projectedMessages,
    clearBranchCache,
    deleteMessageTrigger,
    rollbackBranch,
    setMessages,
    syncChatStateFromDB,
    topic.id
  ])

  const handleEditMessage = useCallback<V2ChatOverrides['editMessage']>(
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
      setMessages((msgs) =>
        msgs.map((m) => (m.id === messageId ? { ...m, parts: editedParts as CherryUIMessage['parts'] } : m))
      )
      try {
        await patchMessageTrigger({ params: { id: messageId }, body: { data: { parts: editedParts } } })
        logger.info('Edited message', { messageId, partCount: editedParts.length })
      } catch (err) {
        await rollbackBranch()
        await syncChatStateFromDB()
        throw err
      }
      await syncChatStateFromDB()
    },
    [patchMessageTrigger, rollbackBranch, seedOptimisticBranch, setMessages, syncChatStateFromDB]
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

      await regenerate({
        messageId,
        body: {
          ...capabilityBody,
          ...(parentAnchorId && { parentAnchorId }),
          ...(regenModelId && { mentionedModels: [regenModelId] })
        }
      })
    },
    [regenerate, capabilityBody, uiMessages]
  )

  const handleForkAndResend = useCallback<V2ChatOverrides['forkAndResend']>(
    async (messageId, editedParts) => {
      const newMessage = await createSiblingTrigger({
        params: { id: messageId },
        body: { parts: editedParts }
      })
      // Sync `useChat` from DB before regenerate. The server flipped
      // `activeNodeId` to the new branch in the same transaction.
      const refreshed = await refresh()
      setMessages(refreshed)
      logger.info('Forked user message', { sourceId: messageId, newId: newMessage.id })

      // Bypass `regenerateWithCapabilities` here: its `uiMessages`
      // closure is still the pre-fork snapshot in this microtask (the
      // outer V2ChatContent hasn't re-rendered with the refreshed SWR
      // data yet), so the anchor lookup would miss the new user. We
      // already know the anchor is the new user's own id.
      await regenerate({
        messageId: newMessage.id,
        body: { ...capabilityBody, parentAnchorId: newMessage.id }
      })
    },
    [createSiblingTrigger, refresh, setMessages, regenerate, capabilityBody]
  )

  const handleSetActiveNode = useCallback<V2ChatOverrides['setActiveNode']>(
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
      const refreshed = await refresh()
      setMessages(refreshed)
    },
    [setActiveNodeTrigger, topic.id, refresh, setMessages]
  )

  const handleSetActiveBranch = useCallback<V2ChatOverrides['setActiveBranch']>(
    async (throughNodeId) => {
      let leafId = throughNodeId
      try {
        // Cast: TS can't disambiguate `/topics/:id` vs `/topics/:topicId/path`
        // when both match a template literal — concrete handler returns DbMessage[].
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
      const refreshed = await refresh()
      setMessages(refreshed)
    },
    [setActiveNodeTrigger, topic.id, refresh, setMessages]
  )

  const overrides = useMemo<V2ChatOverrides>(
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
      setActiveBranch: handleSetActiveBranch,
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
      handleSetActiveBranch,
      refresh
    ]
  )

  return { overrides, capabilityBody }
}
