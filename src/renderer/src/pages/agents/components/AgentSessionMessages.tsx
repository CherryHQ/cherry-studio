import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageAnchorLine from '@renderer/pages/home/Messages/MessageAnchorLine'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import PermissionModeDisplay from '@renderer/pages/home/Messages/PermissionModeDisplay'
import { MessagesContainer, ScrollContainer } from '@renderer/pages/home/Messages/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { AgentSessionEntity, Message, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { Spin } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  messages: Message[]
  session: AgentSessionEntity
  sessionTopicId: string
}

const AgentSessionMessages = ({ messages, session, sessionTopicId }: Props) => {
  // Use the same hook as Messages.tsx for consistent behavior
  const { messageNavigation } = useSettings()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { handleScroll: handleScrollPosition } = useScrollPosition(`agent-session-${session.id}`)

  const displayMessages = useMemo(() => {
    if (!messages || messages.length === 0) return []
    return [...messages].reverse()
  }, [messages])

  const groupedMessages = useMemo(() => {
    if (!displayMessages || displayMessages.length === 0) return []
    return Object.entries(getGroupedMessages(displayMessages))
  }, [displayMessages])

  const sessionAssistantId = session.agent_id
  const sessionName = session.name ?? session.id
  const sessionCreatedAt = session.created_at
  const sessionUpdatedAt = session.updated_at

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session,
      assistantId: sessionAssistantId,
      name: sessionName,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [sessionTopicId, sessionAssistantId, sessionName, sessionCreatedAt, sessionUpdatedAt]
  )

  logger.silly('Rendering agent session messages', {
    sessionId: session.id,
    messageCount: messages.length
  })

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0 })
        }
      })
    }
  }, [scrollContainerRef])

  // Listen for send message events to auto-scroll to bottom
  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [scrollToBottom])

  return (
    <MessagesContainer
      id="messages"
      className="messages-container"
      ref={scrollContainerRef}
      onScroll={handleScrollPosition}>
      <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
        <ContextMenu>
          <ScrollContainer>
            {groupedMessages.length > 0 ? (
              groupedMessages.map(([key, groupMessages]) => (
                <MessageGroup key={key} messages={groupMessages} topic={derivedTopic} />
              ))
            ) : session ? (
              <PermissionModeDisplay session={session} agentId={session.agent_id} />
            ) : (
              <div className="flex items-center justify-center py-5">
                <Spin size="small" />
              </div>
            )}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
      {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages} />}
    </MessagesContainer>
  )
}

export default memo(AgentSessionMessages)
