import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { useSession } from '@renderer/hooks/agents/useSession'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { PartsProvider } from '@renderer/pages/home/Messages/Blocks'
import MessageAnchorLine from '@renderer/pages/home/Messages/MessageAnchorLine'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import { MessagesContainer, ScrollContainer } from '@renderer/pages/home/Messages/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Spin } from 'antd'
import type { PropsWithChildren } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import styled from 'styled-components'

const logger = loggerService.withContext('AgentSessionMessages')

const AGENT_PAGE_SIZE = 5

type Props = {
  agentId: string
  sessionId: string
  adaptedMessages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  isLoading: boolean
}

const AgentSessionMessages = ({ agentId, sessionId, adaptedMessages, partsMap, isLoading }: Props) => {
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const { messageNavigation } = useSettings()

  // ── Pagination (same as before) ──

  const { containerRef: scrollContainerRef, handleScroll: handleScrollPosition } = useScrollPosition(
    `agent-session-${sessionId}`
  )
  const { setTimeoutTimer } = useTimer()

  const [displayMessages, setDisplayMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const isRestoringScrollRef = useMemo(() => ({ current: true }), [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    isRestoringScrollRef.current = true
    const timer = setTimeout(() => {
      isRestoringScrollRef.current = false
    }, 150)
    return () => clearTimeout(timer)
  }, [sessionId, isRestoringScrollRef])

  useEffect(() => {
    const newDisplayMessages = computeDisplayMessages(adaptedMessages, 0, AGENT_PAGE_SIZE)
    setDisplayMessages(newDisplayMessages)
    setHasMore(adaptedMessages.length > AGENT_PAGE_SIZE)
  }, [adaptedMessages])

  const groupedMessages = useMemo(() => {
    const grouped = Object.entries(getGroupedMessages(displayMessages))
    const newGrouped: { [key: string]: Message[] } = {}
    grouped.forEach(([key, group]) => {
      newGrouped[key] = group.toReversed()
    })
    return Object.entries(newGrouped)
  }, [displayMessages])

  const loadMoreMessages = useCallback(() => {
    if (!hasMore || isLoadingMore || isRestoringScrollRef.current) return

    setIsLoadingMore(true)
    setTimeoutTimer(
      'loadMoreMessages',
      () => {
        const currentLength = displayMessages.length
        const newMessages = computeDisplayMessages(adaptedMessages, currentLength, AGENT_PAGE_SIZE)

        setDisplayMessages((prev) => [...prev, ...newMessages])
        setHasMore(currentLength + AGENT_PAGE_SIZE < adaptedMessages.length)
        setIsLoadingMore(false)
      },
      300
    )
  }, [displayMessages.length, hasMore, isLoadingMore, adaptedMessages, setTimeoutTimer, isRestoringScrollRef])

  // ── Derived topic for MessageGroup ──

  const sessionAssistantId = session?.agentId ?? agentId
  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.createdAt ?? session?.updatedAt ?? FALLBACK_TIMESTAMP
  const sessionUpdatedAt = session?.updatedAt ?? session?.createdAt ?? FALLBACK_TIMESTAMP

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session as TopicTypeEnum,
      assistantId: sessionAssistantId,
      name: sessionName,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [sessionTopicId, sessionAssistantId, sessionName, sessionCreatedAt, sessionUpdatedAt]
  )

  // ── Scroll to bottom on send ──

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0 })
        }
      })
    }
  }, [scrollContainerRef])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [scrollToBottom])

  logger.silly('Rendering agent session messages', {
    sessionId,
    messageCount: adaptedMessages.length
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spin size="small" />
      </div>
    )
  }

  return (
    <PartsProvider value={partsMap}>
      <AgentSessionChatContextBridge topic={derivedTopic}>
        <MessagesContainer
          id="messages"
          className="messages-container"
          ref={scrollContainerRef}
          onScroll={handleScrollPosition}>
          <NarrowLayout style={{ display: 'flex', flexDirection: 'column-reverse' }}>
            <InfiniteScroll
              dataLength={displayMessages.length}
              next={loadMoreMessages}
              hasMore={hasMore}
              loader={null}
              scrollableTarget="messages"
              inverse
              style={{ overflow: 'visible' }}>
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
                  {isLoadingMore && (
                    <LoaderContainer>
                      <LoadingIcon color="var(--color-text-2)" />
                    </LoaderContainer>
                  )}
                </ScrollContainer>
              </ContextMenu>
            </InfiniteScroll>
          </NarrowLayout>
          {messageNavigation === 'anchor' && <MessageAnchorLine messages={displayMessages} />}
        </MessagesContainer>
      </AgentSessionChatContextBridge>
    </PartsProvider>
  )
}

const AgentSessionChatContextBridge = ({ topic, children }: PropsWithChildren<{ topic: Topic }>) => {
  const chatContextValue = useChatContextProvider(topic)
  return <ChatContextProvider value={chatContextValue}>{children}</ChatContextProvider>
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

const computeDisplayMessages = (messages: Message[], startIndex: number, displayCount: number) => {
  if (messages.length - startIndex <= displayCount) {
    const result: Message[] = []
    for (let i = messages.length - 1 - startIndex; i >= 0; i--) {
      result.push(messages[i])
    }
    return result
  }
  const userIdSet = new Set<string>()
  const assistantIdSet = new Set<string>()
  const displayMessages: Message[] = []

  const processMessage = (message: Message) => {
    if (!message) return
    const idSet = message.role === 'user' ? userIdSet : assistantIdSet
    const messageId = message.role === 'user' ? message.id : (message.askId ?? message.id)
    if (!idSet.has(messageId)) {
      idSet.add(messageId)
      displayMessages.push(message)
      return
    }
    displayMessages.push(message)
  }

  for (let i = messages.length - 1 - startIndex; i >= 0 && userIdSet.size + assistantIdSet.size < displayCount; i--) {
    processMessage(messages[i])
  }

  return displayMessages
}

const LoaderContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 10px;
  width: 100%;
  background: var(--color-background);
  pointer-events: none;
`

export default memo(AgentSessionMessages)
