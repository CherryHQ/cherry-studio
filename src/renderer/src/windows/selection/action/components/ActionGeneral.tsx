import { useChat } from '@ai-sdk/react'
import { LoadingOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { MessageContentProvider } from '@renderer/components/chat/messages'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/adapters/useMessageListRenderConfig'
import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import ExecutionStreamCollector from '@renderer/components/chat/messages/stream/ExecutionStreamCollector'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import CopyButton from '@renderer/components/CopyButton'
import { useAssistant, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WindowFooter from './WindowFooter'

const logger = loggerService.withContext('ActionGeneral')
interface Props {
  action: SelectionActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [showOriginal, setShowOriginal] = useState(false)
  const { renderConfig } = useMessageListRenderConfig()

  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { assistant: chosenAssistant } = useAssistant(action.assistantId ?? '')
  const activeAssistant = chosenAssistant ?? defaultAssistant

  // Temporary in-memory topic — never touches SQLite, released on unmount.
  // activeAssistant may be the synthesised default — only pass a real
  // persisted id (chosenAssistant) to bind the temp topic to.
  const { topicId: temporaryTopicId, ready } = useTemporaryTopic({ assistantId: chosenAssistant?.id })

  const promptContent = useMemo(() => {
    let userContent = ''
    switch (action.id) {
      case 'summary':
        userContent = t('selection.action.prompt.summary', { language }) + action.selectedText
        break
      case 'explain':
        userContent = t('selection.action.prompt.explain', { language }) + action.selectedText
        break
      case 'refine':
        userContent = t('selection.action.prompt.refine', { text: action.selectedText ?? '' })
        break
      default:
        if (!action.prompt) {
          userContent = action.selectedText || ''
          break
        }

        if (action.prompt.includes('{{text}}')) {
          userContent = action.prompt.replaceAll('{{text}}', action.selectedText!)
          break
        }

        userContent = action.prompt + '\n\n' + action.selectedText
    }
    return userContent
  }, [action, language, t])

  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const { sendMessage, stop: stopChat } = useChat<CherryUIMessage>({
    // Once the temporary topic id arrives, the chat reinitializes with it.
    // Before that we use a stable placeholder so `useChat` doesn't thrash across renders.
    id: temporaryTopicId ?? 'pending-temp',
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setCompletionError(err.message)
    }
  })

  // Per-execution collector pattern (see ActionTranslate for the why).
  const { activeExecutions, isPending } = useTopicStreamStatus(temporaryTopicId ?? 'pending-temp')
  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } = useExecutionMessages()

  const executionChats = useExecutionChats(temporaryTopicId ?? 'pending-temp', activeExecutions)

  useEffect(() => {
    if (isPending) {
      setIsPreparing(false)
      scrollToBottom?.()
    }
  }, [isPending, scrollToBottom])

  const latestAssistantUIMsg = useMemo<CherryUIMessage | undefined>(() => {
    for (const execMessages of Object.values(executionMessagesById)) {
      for (let i = execMessages.length - 1; i >= 0; i--) {
        if (execMessages[i].role === 'assistant') return execMessages[i]
      }
    }
    return undefined
  }, [executionMessagesById])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(
    () =>
      latestAssistantUIMsg ? { [latestAssistantUIMsg.id]: latestAssistantUIMsg.parts as CherryMessagePart[] } : {},
    [latestAssistantUIMsg]
  )

  const latestAssistantMessage = useMemo(() => {
    if (!latestAssistantUIMsg) return null
    return toMessageListItem(
      {
        ...latestAssistantUIMsg,
        metadata: {
          ...latestAssistantUIMsg.metadata,
          status: isPending ? 'pending' : 'success'
        }
      },
      { assistantId: activeAssistant?.id, topicId: temporaryTopicId ?? '' }
    )
  }, [activeAssistant?.id, latestAssistantUIMsg, isPending, temporaryTopicId])

  const content = useMemo(
    () => (latestAssistantUIMsg ? getTextFromParts(latestAssistantUIMsg.parts as CherryMessagePart[]) : ''),
    [latestAssistantUIMsg]
  )

  const isStreaming = isPending
  const error = completionError

  const fetchResult = useCallback(() => {
    if (!ready || !temporaryTopicId) return
    logger.debug('Before process message', { assistant: activeAssistant })
    setCompletionError(null)
    setIsPreparing(true)
    // topicId comes from useChat id; Main resolves assistant/model from topic.assistantId.
    // No body fields are read by IpcChatTransport for this codepath.
    void sendMessage({ text: promptContent })
  }, [activeAssistant, ready, temporaryTopicId, promptContent, sendMessage])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const handlePause = () => {
    void stopChat()
    if (temporaryTopicId) void pauseTrace(temporaryTopicId)
  }

  const handleRegenerate = () => {
    fetchResult()
  }

  return (
    <>
      <Container>
        <MenuContainer>
          <OriginalHeader onClick={() => setShowOriginal(!showOriginal)}>
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={showOriginal ? 'expanded' : ''} />
          </OriginalHeader>
        </MenuContainer>
        {showOriginal && (
          <OriginalContent>
            {action.selectedText}
            <OriginalContentCopyWrapper>
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </OriginalContentCopyWrapper>
          </OriginalContent>
        )}
        <Result>
          {temporaryTopicId &&
            activeExecutions.map(({ executionId }) => {
              const execChat = executionChats.get(executionId)
              if (!execChat) return null
              return (
                <ExecutionStreamCollector
                  key={executionId}
                  executionId={executionId}
                  chat={execChat}
                  onMessagesChange={handleExecutionMessagesChange}
                  onDispose={handleExecutionDispose}
                />
              )
            })}
          {isPreparing && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {!isPreparing && latestAssistantMessage && (
            <MessageContentProvider
              messages={[latestAssistantMessage]}
              partsByMessageId={partsMap}
              renderConfig={renderConfig}>
              <MessageContent key={latestAssistantMessage.id} message={latestAssistantMessage} />
            </MessageContentProvider>
          )}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
    </>
  )
})

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
`

const Result = styled.div`
  margin-top: 4px;
  width: 100%;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
`

const OriginalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;

  &:hover {
    color: var(--color-primary);
  }

  .lucide {
    transition: transform 0.2s ease;
    &.expanded {
      transform: rotate(180deg);
    }
  }
`

const OriginalContent = styled.div`
  padding: 8px;
  margin-top: 8px;
  margin-bottom: 12px;
  background-color: var(--color-background-soft);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const OriginalContentCopyWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
`

const FooterPadding = styled.div`
  min-height: 12px;
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
`

export default ActionGeneral
