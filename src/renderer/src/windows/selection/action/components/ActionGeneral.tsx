import { LoadingOutlined } from '@ant-design/icons'
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
import { Assistant, Topic } from '@renderer/types'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { ChevronDown } from 'lucide-react'
import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'

interface Props {
  action: ActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { language } = useSettings()
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [isContented, setIsContented] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
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
        userContent =
          `请总结下面的内容。要求：使用 ${language} 语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
        break
      case 'explain':
        userContent =
          `请解释下面的内容。要求：使用 ${language} 语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
        break
      case 'refine':
        userContent =
          `请根据下面的内容进行优化或润色，并保持原内容的含义和完整性。要求：使用原语言进行回复；请不要包含对本提示词的任何解释，直接给出回复： \n\n` +
          action.selectedText
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
  }, [action, language])

  const fetchResult = useCallback(() => {
    const setAskId = (id: string) => {
      askId.current = id
    }
    const onStream = () => {
      setIsContented(true)
      scrollToBottom?.()
    }
    const onFinish = (content: string) => {
      setContentToCopy(content)
      setIsLoading(false)
    }
    const onError = (error: Error) => {
      setIsLoading(false)
      setError(error.message)
    }

    if (!assistantRef.current || !topicRef.current) return
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

  // Memoize the messages to prevent unnecessary re-renders
  const messageContent = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
    return lastAssistantMessage ? <MessageContent key={lastAssistantMessage.id} message={lastAssistantMessage} /> : null
  }, [allMessages])

  const handlePause = () => {
    if (askId.current) {
      abortCompletion(askId.current)
      setIsLoading(false)
    }
    if (topicRef.current?.id) {
      pauseTrace(topicRef.current.id)
    }
  }

  const handleRegenerate = () => {
    setContentToCopy('')
    setIsLoading(true)
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
          {!isContented && isLoading && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {messageContent}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isLoading} onPause={handlePause} onRegenerate={handleRegenerate} content={contentToCopy} />
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
