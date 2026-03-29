import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageAnchorLine from '@renderer/pages/home/Messages/MessageAnchorLine'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import PermissionModeDisplay from '@renderer/pages/home/Messages/PermissionModeDisplay'
import { MessagesContainer, ScrollContainer } from '@renderer/pages/home/Messages/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import store, { useAppDispatch } from '@renderer/store'
import {
  addChannelUserMessage,
  type ChannelStreamController,
  setupChannelStream
} from '@renderer/store/thunk/messageThunk'
import { type Topic, TopicType } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Spin } from 'antd'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
}

const AgentSessionMessages = ({ agentId, sessionId }: Props) => {
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  // Use the same hook as Messages.tsx for consistent behavior
  const messages = useTopicMessages(sessionTopicId)
  const { messageNavigation } = useSettings()
  const dispatch = useAppDispatch()

  // Subscribe to real-time IM channel stream chunks and render via BlockManager pipeline
  const streamCtrlRef = useRef<ChannelStreamController | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    // Subscribe to IPC stream chunks for this session
    window.api.agentSessionStream.subscribe(sessionId)

    const getOrCreateStream = () => {
      if (!streamCtrlRef.current) {
        streamCtrlRef.current = setupChannelStream(
          dispatch,
          store.getState,
          sessionTopicId,
          agentId,
          sessionRef.current?.model
        )
      }
      return streamCtrlRef.current
    }

    const cleanupChunk = window.api.agentSessionStream.onChunk((event) => {
      if (event.sessionId !== sessionId) return

      if (event.type === 'user-message' && event.userMessage) {
        addChannelUserMessage(dispatch, sessionTopicId, agentId, event.userMessage.text)
        getOrCreateStream()
      } else if (event.type === 'chunk' && event.chunk) {
        getOrCreateStream().pushChunk(event.chunk)
      } else if (event.type === 'complete') {
        streamCtrlRef.current?.complete()
        streamCtrlRef.current = null
      } else if (event.type === 'error') {
        streamCtrlRef.current?.error(new Error(event.error?.message ?? 'Stream error'))
        streamCtrlRef.current = null
      }
    })

    return () => {
      cleanupChunk()
      streamCtrlRef.current?.complete()
      streamCtrlRef.current = null
      window.api.agentSessionStream.unsubscribe(sessionId)
    }
  }, [sessionId, sessionTopicId, agentId, dispatch])

  const { containerRef: scrollContainerRef, handleScroll: handleScrollPosition } = useScrollPosition(
    `agent-session-${sessionId}`
  )

  const displayMessages = useMemo(() => {
    if (!messages || messages.length === 0) return []
    return [...messages].reverse()
  }, [messages])

  const groupedMessages = useMemo(() => {
    if (!displayMessages || displayMessages.length === 0) return []
    return Object.entries(getGroupedMessages(displayMessages))
  }, [displayMessages])

  const sessionAssistantId = session?.agent_id ?? agentId
  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.created_at ?? session?.updated_at ?? FALLBACK_TIMESTAMP
  const sessionUpdatedAt = session?.updated_at ?? session?.created_at ?? FALLBACK_TIMESTAMP

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
    sessionId,
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
              <PermissionModeDisplay session={session} agentId={agentId} />
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

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
