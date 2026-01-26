import { LoadingOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import {
  getAssistantById,
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic
} from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import type { Assistant, Topic } from '@renderer/types'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'

const logger = loggerService.withContext('ActionGeneral')
interface Props {
  action: ActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { language } = useSettings()
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [status, setStatus] = useState<'preparing' | 'streaming' | 'finished'>('preparing')
  const [contentToCopy, setContentToCopy] = useState('')
  const initialized = useRef(false)

  // Use useRef for values that shouldn't trigger re-renders
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const promptContentRef = useRef('')
  const askId = useRef('')

  // Initialize values only once when action changes
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Initialize assistant
    const currentAssistant = action.assistantId
      ? getAssistantById(action.assistantId) || getDefaultAssistant()
      : getDefaultAssistant()

    assistantRef.current = {
      ...currentAssistant,
      model: currentAssistant.model || getDefaultModel()
    }

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)

    // Initialize prompt content
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
    promptContentRef.current = userContent
  }, [action, language, t])

  const fetchResult = useCallback(() => {
    if (!initialized.current) {
      return
    }
    setStatus('preparing')

    const setAskId = (id: string) => {
      askId.current = id
    }
    const onStream = () => {
      setStatus('streaming')
      scrollToBottom?.()
    }
    const onFinish = (content: string) => {
      setStatus('finished')
      setContentToCopy(content)
    }
    const onError = (error: Error) => {
      setStatus('finished')
      setError(error.message)
    }

    if (!assistantRef.current || !topicRef.current) return
    logger.debug('Before peocess message', { assistant: assistantRef.current })
    processMessages(
      assistantRef.current,
      topicRef.current,
      promptContentRef.current,
      setAskId,
      onStream,
      onFinish,
      onError
    )
  }, [scrollToBottom])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const allMessages = useTopicMessages(topicRef.current?.id || '')

  const currentAssistantMessage = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    if (assistantMessages.length === 0) {
      return null
    }
    return assistantMessages[assistantMessages.length - 1]
  }, [allMessages])

  useEffect(() => {
    // Sync message status
    switch (currentAssistantMessage?.status) {
      case AssistantMessageStatus.PROCESSING:
      case AssistantMessageStatus.PENDING:
      case AssistantMessageStatus.SEARCHING:
        setStatus('streaming')
        break
      case AssistantMessageStatus.PAUSED:
      case AssistantMessageStatus.ERROR:
      case AssistantMessageStatus.SUCCESS:
        setStatus('finished')
        break
      case undefined:
        break
      default:
        logger.warn('Unexpected assistant message status:', { status: currentAssistantMessage?.status })
    }
  }, [currentAssistantMessage?.status])

  const isPreparing = status === 'preparing'
  const isStreaming = status === 'streaming'

  const handlePause = () => {
    if (askId.current) {
      abortCompletion(askId.current)
    }
    if (topicRef.current?.id) {
      pauseTrace(topicRef.current.id)
    }
  }

  const handleRegenerate = () => {
    setContentToCopy('')
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
          {isPreparing && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {!isPreparing && currentAssistantMessage && (
            <MessageContent key={currentAssistantMessage.id} message={currentAssistantMessage} />
          )}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter
        loading={isStreaming}
        onPause={handlePause}
        onRegenerate={handleRegenerate}
        content={contentToCopy}
      />
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
