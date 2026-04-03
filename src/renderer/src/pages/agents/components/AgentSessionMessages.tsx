import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useSession } from '@renderer/hooks/agents/useSession'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageAnchorLine from '@renderer/pages/home/Messages/MessageAnchorLine'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import { MessagesContainer, ScrollContainer } from '@renderer/pages/home/Messages/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import store, { useAppDispatch } from '@renderer/store'
import {
  addChannelUserMessage,
  type ChannelStreamController,
  loadTopicMessagesThunk,
  setupChannelStream
} from '@renderer/store/thunk/messageThunk'
import { type Topic, TopicType } from '@renderer/types'
import { addAbortController } from '@renderer/utils/abortController'
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

  // Ensure messages are loaded when session changes (e.g. navigating from task logs)
  useEffect(() => {
    void dispatch(loadTopicMessagesThunk(sessionTopicId))
  }, [dispatch, sessionTopicId])

  // Use agent's model as fallback when session model is not yet available
  const { agent } = useAgent(agentId)
  const agentModelRef = useRef(agent?.model)
  agentModelRef.current = agent?.model

  // Subscribe to real-time IM channel stream chunks and render via BlockManager pipeline
  const streamCtrlRef = useRef<ChannelStreamController | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  // Guard flag: once the current exchange is done (complete/error), prevent
  // getOrCreateStream() from creating a second assistant message if any
  // late-arriving chunk events are processed after the controller is cleared.
  const exchangeDoneRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let cleanupChunk: (() => void) | null = null
    exchangeDoneRef.current = false

    const getOrCreateStream = () => {
      if (exchangeDoneRef.current) return streamCtrlRef.current
      if (!streamCtrlRef.current) {
        streamCtrlRef.current = setupChannelStream(
          dispatch,
          store.getState,
          sessionTopicId,
          agentId,
          sessionRef.current?.model ?? agentModelRef.current
        )
      }
      return streamCtrlRef.current
    }

    // Await subscribe before registering the chunk listener.
    // This ensures the main-process bus subscription is active before any
    // events can be published, eliminating the race where user-message is
    // published before the subscriber exists.
    const init = async () => {
      await window.api.agentSessionStream.subscribe(sessionId)
      if (cancelled) return

      cleanupChunk = window.api.agentSessionStream.onChunk((event) => {
        if (event.sessionId !== sessionId) return

        if (event.type === 'user-message' && event.userMessage) {
          // A new exchange starts — reset the done flag
          exchangeDoneRef.current = false
          addChannelUserMessage(dispatch, sessionTopicId, agentId, event.userMessage.text, event.userMessage.images)
          const ctrl = getOrCreateStream()
          if (ctrl) {
            // Register abort callback so the input bar's stop button can abort the main process stream
            addAbortController(ctrl.assistantMessageId, () => {
              void window.api.agentSessionStream.abort(sessionId)
            })
          }
        } else if (event.type === 'chunk' && event.chunk) {
          getOrCreateStream()?.pushChunk(event.chunk)
        } else if (event.type === 'complete') {
          exchangeDoneRef.current = true
          streamCtrlRef.current?.complete()
          streamCtrlRef.current = null
        } else if (event.type === 'error') {
          exchangeDoneRef.current = true
          // Push the error as a data chunk so the adapter can render it via
          // onError, then close the stream normally. Using complete() instead
          // of error() preserves any previously-enqueued chunks that the
          // adapter hasn't read yet (ReadableStream.error() discards them).
          if (streamCtrlRef.current) {
            streamCtrlRef.current.pushChunk({
              type: 'error',
              error: new Error(event.error?.message ?? 'Stream error')
            } as any)
            streamCtrlRef.current.complete()
          }
          streamCtrlRef.current = null
        }
      })
    }

    void init()

    return () => {
      cancelled = true
      cleanupChunk?.()
      streamCtrlRef.current?.complete()
      streamCtrlRef.current = null
      void window.api.agentSessionStream.unsubscribe(sessionId)
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
            ) : !session ? (
              <div className="flex items-center justify-center py-5">
                <Spin size="small" />
              </div>
            ) : null}
          </ScrollContainer>
        </ContextMenu>
      </NarrowLayout>
      {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages} />}
    </MessagesContainer>
  )
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
