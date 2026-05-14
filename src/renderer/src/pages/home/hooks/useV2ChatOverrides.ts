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
  const { topic, uiMessages, regenerate, setMessages, stop, refresh, cache } = params
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

  const handleDeleteMessage = useCallback<V2ChatOverrides['deleteMessage']>(
    async (id, traceOptions) => {
      const optimisticIds = new Set([id])
      await seedOptimisticBranch((prev) => branchWithoutIds(prev, optimisticIds))

      try {
        await deleteMessageTrigger({ params: { id }, query: { cascade: false } })
      } catch (err: unknown) {
        if (err instanceof DataApiError && err.code === ErrorCode.INVALID_OPERATION) {
          try {
            const result = await deleteMessageTrigger({ params: { id }, query: { cascade: true } })
            const deletedSet = new Set(result.deletedIds)
            await seedOptimisticBranch((prev) => branchWithoutIds(prev, deletedSet))
          } catch (cascadeErr) {
            await rollbackBranch()
            throw cascadeErr
          }
        } else {
          await rollbackBranch()
          throw err
        }
      }
      void window.api.trace.cleanHistory(topic.id, traceOptions?.traceId ?? '', traceOptions?.modelName)
      logger.info('Deleted message', { id })
    },
    [branchWithoutIds, deleteMessageTrigger, rollbackBranch, seedOptimisticBranch, topic.id]
  )

  const handleDeleteMessageGroup = useCallback<V2ChatOverrides['deleteMessageGroup']>(
    async (id: string) => {
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
    [branchWithoutIds, deleteMessageTrigger, rollbackBranch, seedOptimisticBranch]
  )

  const handleClearTopicMessages = useCallback(async () => {
    const rootMsg = uiMessages.find((m) => m.metadata?.parentId == null) ?? uiMessages[0]
    if (!rootMsg) return
    await clearBranchCache()
    try {
      await deleteMessageTrigger({ params: { id: rootMsg.id }, query: { cascade: true } })
      logger.info('Cleared all messages via root cascade delete', { topicId: topic.id, rootId: rootMsg.id })
    } catch (err) {
      await rollbackBranch()
      throw err
    }
  }, [uiMessages, clearBranchCache, deleteMessageTrigger, rollbackBranch, topic.id])

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
    },
    [setActiveNodeTrigger, topic.id]
  )

  const handleSetActiveBranch = useCallback<V2ChatOverrides['setActiveBranch']>(
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
