import { useSession } from '@renderer/hooks/agents/useSession'
import { getModel } from '@renderer/hooks/useModel'
import { useSideQuestion } from '@renderer/hooks/useSideQuestion'
import type { Message } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Button, Input, Tooltip } from 'antd'
import { ArrowLeft, CircleHelp, CirclePause, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styled from 'styled-components'

interface Props {
  sourceMessage: Message | null
  agentId: string
  sessionId: string
  onClose: () => void
}

export const AgentSideQuestion: FC<Props> = ({ sourceMessage, agentId, sessionId, onClose }) => {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const chatAreaRef = useRef<HTMLDivElement>(null)
  const { session } = useSession(agentId, sessionId)

  // Resolve the session's model
  const sessionModel = useMemo(() => {
    if (!session?.model) return undefined
    const [providerId, actualModelId] = session.model.split(':')
    return actualModelId ? getModel(actualModelId, providerId) : undefined
  }, [session?.model])

  const { messages, isLoading, sendQuestion, stopGeneration, syncMessages } = useSideQuestion(
    sourceMessage,
    sessionModel
  )

  useEffect(() => {
    if (sourceMessage) {
      syncMessages(sourceMessage.id)
    }
  }, [sourceMessage, syncMessages])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isLoading) return
    const question = inputValue
    setInputValue('')
    void sendQuestion(question)
  }, [inputValue, isLoading, sendQuestion])

  if (!sourceMessage) return null

  const contextText = getMainTextContent(sourceMessage)

  return (
    <Container>
      <Header>
        <BackButton type="text" icon={<ArrowLeft size={16} />} onClick={onClose} />
        <Title>{t('chat.sideQuestion.title')}</Title>
        <Tooltip title={t('chat.sideQuestion.help')} placement="bottomRight">
          <HelpIcon>
            <CircleHelp size={14} />
          </HelpIcon>
        </Tooltip>
      </Header>

      <ContextQuote>
        <QuoteText>{contextText}</QuoteText>
      </ContextQuote>

      <ChatArea ref={chatAreaRef}>
        {messages.length === 0 ? (
          <PlaceholderText>{t('chat.sideQuestion.empty')}</PlaceholderText>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} $isUser={msg.role === 'user'}>
              {msg.role === 'user' ? (
                <UserText>{msg.content}</UserText>
              ) : (
                <AssistantContent>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  {msg.status === 'streaming' && !msg.content && (
                    <LoadingIndicator>
                      <Loader2 size={14} className="animate-spin" />
                    </LoadingIndicator>
                  )}
                </AssistantContent>
              )}
            </MessageBubble>
          ))
        )}
      </ChatArea>

      <InputArea>
        <Input.TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={t('chat.sideQuestion.placeholder')}
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={isLoading}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        {isLoading ? (
          <Tooltip title={t('chat.input.pause')} placement="top" mouseLeaveDelay={0} arrow>
            <PauseIcon onClick={stopGeneration}>
              <CirclePause size={20} />
            </PauseIcon>
          </Tooltip>
        ) : (
          <i
            className="iconfont icon-ic_send"
            onClick={inputValue.trim() ? handleSend : undefined}
            role="button"
            aria-label={t('chat.input.send')}
            aria-disabled={!inputValue.trim()}
            tabIndex={inputValue.trim() ? 0 : -1}
            style={{
              cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
              color: inputValue.trim() ? 'var(--color-primary)' : 'var(--color-text-3)',
              fontSize: 22,
              transition: 'all 0.2s',
              flexShrink: 0
            }}
          />
        )}
      </InputArea>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--color-background-2);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
`

const BackButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--color-text-2);
`

const Title = styled.div`
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-1);
  flex: 1;
`

const HelpIcon = styled.span`
  display: flex;
  align-items: center;
  color: var(--color-text-3);
  cursor: help;

  &:hover {
    color: var(--color-text-2);
  }
`

const ContextQuote = styled.div`
  padding: 12px 16px;
  background-color: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
`

const QuoteText = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-style: italic;
  border-left: 3px solid var(--color-primary);
  padding-left: 8px;
`

const ChatArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PlaceholderText = styled.div`
  color: var(--color-text-3);
  font-size: 13px;
  text-align: center;
  margin-top: 20px;
`

const MessageBubble = styled.div<{ $isUser: boolean }>`
  display: flex;
  justify-content: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
`

const UserText = styled.div`
  background-color: var(--color-primary);
  color: white;
  padding: 8px 12px;
  border-radius: 12px 12px 2px 12px;
  font-size: 13px;
  max-width: 85%;
  word-break: break-word;
  white-space: pre-wrap;
`

const AssistantContent = styled.div`
  background-color: var(--color-background-soft);
  padding: 8px 12px;
  border-radius: 12px 12px 12px 2px;
  font-size: 13px;
  max-width: 85%;
  word-break: break-word;

  p {
    margin: 0 0 8px 0;
    &:last-child {
      margin-bottom: 0;
    }
  }

  pre {
    background-color: var(--color-background-mute);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 12px;
  }

  code {
    font-size: 12px;
  }

  ul,
  ol {
    margin: 4px 0;
    padding-left: 20px;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 12px;
  }

  th,
  td {
    border: 1px solid var(--color-border);
    padding: 4px 8px;
    text-align: left;
  }

  th {
    background-color: var(--color-background-mute);
    font-weight: 600;
  }
`

const LoadingIndicator = styled.div`
  display: flex;
  align-items: center;
  color: var(--color-text-3);
`

const InputArea = styled.div`
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 8px;
  align-items: flex-end;
`

const PauseIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-error);
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  transition: all 0.2s;

  &:hover {
    background-color: var(--color-background-soft);
  }
`
