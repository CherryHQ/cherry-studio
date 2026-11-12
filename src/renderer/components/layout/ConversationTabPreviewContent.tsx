import { isToolUIPart } from 'ai'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useDataChange, useInfiniteFlatItems } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { MessagePreview } from '@renderer/components/chat/messages/frame/MessagePreview'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { toAgentSessionUIMessage } from '@renderer/hooks/useAgentSessionParts'
import { useConversationHistoryQuery } from '@renderer/hooks/useConversationHistoryQuery'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import {
  useTopicStreamStatus,
  useTopicDbRefreshOnAwaitingApproval,
  useTopicOverlayHandoffOnTerminal
} from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { selectConversationPreview } from '@renderer/utils/message/conversationPreview'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

const logger = loggerService.withContext('ConversationTabPreview')

function topicIdFor(target: ConversationNavigationTarget) {
  return target.conversationType === 'agent' ? buildAgentSessionTopicId(target.conversationId) : target.conversationId
}

export default function ConversationTabPreviewContent({
  target,
  onOpen
}: {
  target: ConversationNavigationTarget
  onOpen: (messageId?: string) => void
}) {
  const { t } = useTranslation()
  const topicId = topicIdFor(target)
  const stream = useTopicStreamStatus(topicId)
  const agent = target.conversationType === 'agent'
  const anchorId = stream.awaitingApprovalAnchors.find((entry) => entry.anchorMessageId)?.anchorMessageId
  const topics = useConversationHistoryQuery('/topics/:topicId/messages', {
    params: { topicId: target.conversationId },
    query: { includeSiblings: false, nodeId: anchorId },
    limit: 4,
    swrOptions: { revalidateOnMount: true, dedupingInterval: 0, keepPreviousData: false },
    enabled: !agent
  })
  const sessions = useConversationHistoryQuery('/agent-sessions/:sessionId/messages', {
    params: { sessionId: target.conversationId },
    query: { messageId: anchorId, deferToolOutputs: true },
    limit: 4,
    swrOptions: { revalidateOnMount: true, dedupingInterval: 0, keepPreviousData: false },
    enabled: agent
  })
  const query = agent ? sessions : topics
  const refresh = async () => {
    await query.mutate()
  }
  const refreshInBackground = () => {
    void refresh().catch((error) => logger.warn('Failed to refresh preview', error))
  }
  useDataChange(
    '/topics/:topicId/messages',
    () => {
      if (!agent) refreshInBackground()
    },
    { routeParams: { topicId: target.conversationId } }
  )
  useDataChange(
    '/agent-sessions/:sessionId/messages',
    () => {
      if (agent) refreshInBackground()
    },
    { routeParams: { sessionId: target.conversationId } }
  )
  const executions = useMemo(
    () => [...stream.activeExecutions, ...stream.awaitingApprovalAnchors],
    [stream.activeExecutions, stream.awaitingApprovalAnchors]
  )
  const live = useExecutionOverlay(topicId, executions, { onFinish: refreshInBackground })
  useTopicDbRefreshOnAwaitingApproval(topicId, refresh)
  useTopicOverlayHandoffOnTerminal(
    topicId,
    async () => {
      await refresh()
      live.reset()
    },
    live.liveAssistants
  )
  const topicRows = useInfiniteFlatItems(topics.pages, { reversePages: true })
  const sessionRows = useInfiniteFlatItems(sessions.pages, { reversePages: true, reverseItems: true })
  const messages = useMemo(() => {
    const history = agent
      ? sessionRows.map(toAgentSessionUIMessage)
      : topicRows.map((row) => sharedMessageToUIMessage(row.message))
    const merged = new Map(history.map((message) => [message.id, message]))
    for (const message of live.liveAssistants) merged.set(message.id, message)
    return [...merged.values()]
      .sort((a, b) =>
        a.metadata?.createdAt && b.metadata?.createdAt ? a.metadata.createdAt.localeCompare(b.metadata.createdAt) : 0
      )
      .map((message) => (live.overlay[message.id] ? { ...message, parts: live.overlay[message.id] } : message))
  }, [agent, sessionRows, topicRows, live.liveAssistants, live.overlay])
  const { request, messages: selected } = selectConversationPreview(messages)
  const { renderConfig } = useMessageListRenderConfig()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const open = async () => {
    if (!request) {
      onOpen()
      return
    }
    let messageId: string | undefined
    try {
      const latestMessages = agent
        ? (await sessions.mutate())?.flatMap((page) => page.items.map(toAgentSessionUIMessage))
        : (await topics.mutate())?.flatMap((page) => page.items.map((row) => sharedMessageToUIMessage(row.message)))
      const latest = latestMessages?.find((message) => message.id === request.message.id)
      if (
        latest?.parts.some(
          (part) =>
            isToolUIPart(part) &&
            part.toolCallId === request.part.toolCallId &&
            part.state === 'approval-requested' &&
            part.approval.id === request.part.approval.id
        )
      ) {
        messageId = request.message.id
      }
    } catch (error) {
      logger.warn('Failed to revalidate preview request', { error })
    }
    if (mounted.current) onOpen(messageId)
  }
  return (
    <>
      <div className="flex min-h-0 flex-col overflow-hidden px-3 pt-3">
        {selected.length ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            {selected.map((message) => (
              <MessagePreview
                key={message.id}
                message={message}
                config={renderConfig}
                author={message.role === 'user' ? { name: renderConfig.userName || t('common.you') } : {}}
              />
            ))}
          </div>
        ) : (
          <div className="py-4 text-muted-foreground text-xs">
            {query.isLoading
              ? t('common.loading')
              : query.error
                ? t('globalSearch.error')
                : t('agent.right_pane.flow.no_messages.title')}
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" className="m-2 ml-auto shrink-0" onClick={open}>
        {t('common.open')} ↗
      </Button>
    </>
  )
}
