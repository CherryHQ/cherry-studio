import { loggerService } from '@logger'
import ContextMenu from '@renderer/components/ContextMenu'
import { LoadingIcon } from '@renderer/components/Icons'
import { useSession } from '@renderer/hooks/agents/useSessionDataApi'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { PartsProvider } from '@renderer/pages/home/Messages/Blocks'
import { ChatVirtualList, type ChatVirtualListHandle } from '@renderer/pages/home/Messages/ChatVirtualList'
import MessageAnchorLine from '@renderer/pages/home/Messages/MessageAnchorLine'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import NarrowLayout from '@renderer/pages/home/Messages/NarrowLayout'
import { MessagesContainer } from '@renderer/pages/home/Messages/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import type { Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Spin } from 'antd'
import type { PropsWithChildren } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('AgentSessionMessages')

type Props = {
  agentId: string
  sessionId: string
  adaptedMessages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  isLoading: boolean
  /** Whether more older messages remain on the server (cursor pagination). */
  hasOlder?: boolean
  /** Trigger fetching the next older page. */
  loadOlder?: () => void
}

const AgentSessionMessages = ({
  agentId,
  sessionId,
  adaptedMessages,
  partsMap,
  isLoading,
  hasOlder = false,
  loadOlder
}: Props) => {
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const { messageNavigation } = useSettings()
  const chatListRef = useRef<ChatVirtualListHandle | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()

  // Group messages chronologically; ChatVirtualList renders entries in array
  // order with scroll-to-bottom on first mount, so groups stay oldest-first.
  const groupedMessages = useMemo(() => Object.entries(getGroupedMessages(adaptedMessages)), [adaptedMessages])

  const handleReachTop = useCallback(() => {
    if (!hasOlder || isLoadingMore || !loadOlder) return
    setIsLoadingMore(true)
    loadOlder()
    setTimeoutTimer('agent-load-older-spinner', () => setIsLoadingMore(false), 600)
  }, [hasOlder, isLoadingMore, loadOlder, setTimeoutTimer])

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
    chatListRef.current?.scrollToBottom('instant')
  }, [])

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, scrollToBottom)]
    return () => unsubscribes.forEach((unsub) => unsub())
  }, [scrollToBottom])

  logger.silly('Rendering agent session messages', {
    sessionId,
    messageCount: adaptedMessages.length,
    hasOlder
  })

  if (isLoading && adaptedMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spin size="small" />
      </div>
    )
  }

  return (
    <PartsProvider value={partsMap}>
      <AgentSessionChatContextBridge topic={derivedTopic}>
        <MessagesContainer id="messages" className="messages-container">
          <NarrowLayout style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ContextMenu>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <ChatVirtualList
                  handleRef={chatListRef}
                  items={groupedMessages}
                  getItemKey={([key]) => key}
                  estimateSize={400}
                  overscan={6}
                  hasMoreTop={hasOlder}
                  onReachTop={handleReachTop}
                  renderItem={([key, groupMessages]) => (
                    <MessageGroup key={key} messages={groupMessages} topic={derivedTopic} />
                  )}
                  style={{ flex: 1, minHeight: 0 }}
                />
                {isLoadingMore && (
                  <div
                    className="pointer-events-none flex w-full justify-center py-2.5"
                    style={{ background: 'var(--color-background)' }}>
                    <LoadingIcon color="var(--color-text-2)" />
                  </div>
                )}
              </div>
            </ContextMenu>
          </NarrowLayout>
          {messageNavigation === 'anchor' && <MessageAnchorLine messages={adaptedMessages} />}
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

export default memo(AgentSessionMessages)
