import { useSession } from '@renderer/hooks/agents/useSession'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import MessageGroup from '@renderer/pages/home/Messages/MessageGroup'
import { ScrollContainer } from '@renderer/pages/home/Messages/shared'
import { getGroupedMessages } from '@renderer/services/MessagesService'
import store, { useAppDispatch } from '@renderer/store'
import {
  type ChannelStreamController,
  loadTopicMessagesThunk,
  setupChannelStream
} from '@renderer/store/thunk/messageThunk'
import { type Topic, TopicType } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { TextStreamPart } from 'ai'
import { Spin } from 'antd'
import { AlertTriangle } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

type Props = {
  agentId: string
  sessionId: string
  runCreatedAt: string
  live: boolean
  modelRef?: string
  fallbackText?: string
  fallbackHasStderr?: boolean
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

const CollaborationRunTranscript = ({
  agentId,
  sessionId,
  runCreatedAt,
  live,
  modelRef,
  fallbackText,
  fallbackHasStderr = false
}: Props) => {
  const dispatch = useAppDispatch()
  const { session } = useSession(agentId, sessionId)
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const messages = useTopicMessages(sessionTopicId)
  const streamCtrlRef = useRef<ChannelStreamController | null>(null)
  const [hasLiveChunks, setHasLiveChunks] = useState(false)

  useEffect(() => {
    setHasLiveChunks(false)
    streamCtrlRef.current?.complete()
    streamCtrlRef.current = null
    void dispatch(loadTopicMessagesThunk(sessionTopicId, true))
  }, [dispatch, sessionTopicId, runCreatedAt])

  useEffect(() => {
    if (!live) {
      streamCtrlRef.current?.complete()
      streamCtrlRef.current = null
      return
    }

    let cancelled = false
    let cleanupChunk: (() => void) | null = null

    const ensureStream = () => {
      if (!streamCtrlRef.current) {
        streamCtrlRef.current = setupChannelStream(dispatch, store.getState, sessionTopicId, agentId, modelRef, {
          persistToBackend: false,
          modelRef
        })
      }
      return streamCtrlRef.current
    }

    const init = async () => {
      await window.api.agentSessionStream.subscribe(sessionId)
      if (cancelled) return

      cleanupChunk = window.api.agentSessionStream.onChunk((event) => {
        if (event.sessionId !== sessionId) return

        if (event.type === 'chunk' && event.chunk) {
          setHasLiveChunks(true)
          ensureStream()?.pushChunk(event.chunk as TextStreamPart<Record<string, any>>)
          return
        }

        if (event.type === 'complete') {
          streamCtrlRef.current?.complete()
          streamCtrlRef.current = null
          return
        }

        if (event.type === 'error') {
          const streamError = new Error(event.error?.message ?? 'Stream error')
          const controller = ensureStream()
          controller.pushChunk({ type: 'error', error: streamError } as TextStreamPart<Record<string, any>>)
          controller.complete()
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
  }, [agentId, dispatch, live, modelRef, sessionId, sessionTopicId])

  useEffect(() => {
    const cleanup = window.api.agentSessionStream.onSessionChanged((data) => {
      if (data.sessionId !== sessionId || data.agentId !== agentId) return
      void dispatch(loadTopicMessagesThunk(sessionTopicId, true))
    })
    return cleanup
  }, [agentId, dispatch, sessionId, sessionTopicId])

  const runCreatedAtMs = useMemo(() => new Date(runCreatedAt).getTime(), [runCreatedAt])

  const filteredMessages = useMemo(
    () =>
      messages.filter((message) => {
        const createdAtMs = new Date(message.createdAt).getTime()
        return Number.isFinite(createdAtMs) && createdAtMs >= runCreatedAtMs
      }),
    [messages, runCreatedAtMs]
  )

  const groupedMessages = useMemo(() => Object.entries(getGroupedMessages(filteredMessages)), [filteredMessages])

  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.created_at ?? session?.updated_at ?? FALLBACK_TIMESTAMP
  const sessionUpdatedAt = session?.updated_at ?? session?.created_at ?? FALLBACK_TIMESTAMP

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session,
      assistantId: agentId,
      name: sessionName,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [agentId, sessionCreatedAt, sessionName, sessionTopicId, sessionUpdatedAt]
  )

  if (groupedMessages.length > 0) {
    return (
      <TranscriptShell>
        <ScrollContainer>
          {groupedMessages.map(([key, groupMessages]) => (
            <MessageGroup key={key} messages={groupMessages} topic={derivedTopic} />
          ))}
        </ScrollContainer>
      </TranscriptShell>
    )
  }

  if (fallbackText?.trim()) {
    return (
      <TranscriptShell>
        <FallbackCard $stderr={fallbackHasStderr}>
          <FallbackHeader>
            <span>{hasLiveChunks ? '实时转录同步中' : live ? '连接实时输出中' : '最终输出'}</span>
            {fallbackHasStderr && (
              <FallbackBadge>
                <AlertTriangle size={12} />
                stderr
              </FallbackBadge>
            )}
          </FallbackHeader>
          <FallbackBody>{fallbackText}</FallbackBody>
        </FallbackCard>
      </TranscriptShell>
    )
  }

  return (
    <TranscriptLoading>
      <Spin size="small" />
      <span>{live ? '等待实时输出…' : '加载任务转录…'}</span>
    </TranscriptLoading>
  )
}

const TranscriptShell = styled.div`
  min-height: 0;
`

const TranscriptLoading = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  color: var(--color-text-3);
  font-size: 12px;
`

const FallbackCard = styled.div<{ $stderr: boolean }>`
  border-radius: 10px;
  border: 0.5px solid
    ${({ $stderr }) => ($stderr ? 'color-mix(in srgb, var(--color-error) 40%, transparent)' : 'var(--color-border)')};
  background: ${({ $stderr }) =>
    $stderr ? 'color-mix(in srgb, var(--color-error) 8%, var(--color-background))' : 'var(--color-background)'};
  padding: 10px 12px;
`

const FallbackHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: 600;
`

const FallbackBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-error);
`

const FallbackBody = styled.div`
  color: var(--color-text-1);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
`

export default memo(CollaborationRunTranscript)
