import { LoadingOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import { PartsProvider } from '@renderer/pages/home/Messages/Blocks'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import {
  getAssistantById,
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic
} from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { type ActionSessionSnapshot, processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'

const logger = loggerService.withContext('ActionGeneral')
interface Props {
  action: SelectionActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [status, setStatus] = useState<'preparing' | 'streaming' | 'finished'>('preparing')
  const [contentToCopy, setContentToCopy] = useState('')
  const [assistantMessage, setAssistantMessage] = useState<Message | null>(null)
  const [partsMap, setPartsMap] = useState<Record<string, CherryMessagePart[]>>({})
  const initialized = useRef(false)
  const requestVersionRef = useRef(0)
  const mountedRef = useRef(true)

  // Use useRef for values that shouldn't trigger re-renders
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const promptContentRef = useRef('')
  const askId = useRef('')

  // Initialize values only once when action changes
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (askId.current) {
        abortCompletion(askId.current)
      }
    }
  }, [])

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
    if (askId.current) {
      abortCompletion(askId.current)
      askId.current = ''
    }
    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setStatus('preparing')
    setError(null)
    setAssistantMessage(null)
    setPartsMap({})

    const setAskId = (id: string) => {
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return
      askId.current = id
    }
    const onSessionUpdate = ({ assistantMessage, partsMap }: ActionSessionSnapshot) => {
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return
      setAssistantMessage(assistantMessage)
      setPartsMap(partsMap)
    }
    const onStream = () => {
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return
      setStatus('streaming')
      scrollToBottom?.()
    }
    const onFinish = (content: string) => {
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return
      setStatus('finished')
      askId.current = ''
      setContentToCopy(content)
    }
    const onError = (error: Error) => {
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return
      setStatus('finished')
      askId.current = ''
      setError(error.message)
    }

    if (!assistantRef.current || !topicRef.current) return
    logger.debug('Before peocess message', { assistant: assistantRef.current })
    void processMessages(
      assistantRef.current,
      topicRef.current,
      promptContentRef.current,
      setAskId,
      onSessionUpdate,
      onStream,
      onFinish,
      onError
    )
  }, [scrollToBottom])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const isPreparing = status === 'preparing'
  const isStreaming = status === 'streaming'

  const handlePause = () => {
    if (askId.current) {
      abortCompletion(askId.current)
    }
    if (topicRef.current?.id) {
      void pauseTrace(topicRef.current.id)
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
          {!isPreparing && assistantMessage && (
            <PartsProvider value={partsMap}>
              <MessageContent key={assistantMessage.id} message={assistantMessage} />
            </PartsProvider>
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
