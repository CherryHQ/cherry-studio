import { LoadingOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { LanguagesEnum, UNKNOWN } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import useTranslate from '@renderer/hooks/useTranslate'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import { getDefaultTopic, getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import type { Assistant, Topic, TranslateLanguage } from '@renderer/types'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { Tooltip } from 'antd'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'
interface Props {
  action: ActionItem
  scrollToBottom: () => void
}

const logger = loggerService.withContext('ActionTranslate')

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { language } = useSettings()
  const { getLanguageByLangcode, isLoaded: isLanguagesLoaded } = useTranslate()

  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(() => {
    const lang = getLanguageByLangcode(language)
    if (lang !== UNKNOWN) {
      return lang
    } else {
      logger.warn('[initialize targetLanguage] Unexpected UNKNOWN. Fallback to zh-CN')
      return LanguagesEnum.zhCN
    }
  })

  const [error, setError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [status, setStatus] = useState<'preparing' | 'streaming' | 'finished'>('preparing')
  const [contentToCopy, setContentToCopy] = useState('')
  const [initialized, setInitialized] = useState(false)

  // Use useRef for values that shouldn't trigger re-renders
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const askId = useRef('')
  const targetLangRef = useRef(targetLanguage)

  // It's called only in initialization.
  // It will change target language, so fetchResult will be triggered. Be careful!
  const updateTargetLanguage = useCallback(async () => {
    // Only called is when languages loaded.
    // It ensure we could get right language from getLanguageByLangcode.
    if (!isLanguagesLoaded) {
      logger.silly('[updateTargetLanguage] Languages are not loaded. Skip.')
      return
    }

    const savedTargetLang = await db.settings.get({ id: 'translate:target:language' })

    if (savedTargetLang && savedTargetLang.value) {
      const targetLang = getLanguageByLangcode(savedTargetLang.value)
      setTargetLanguage(targetLang)
      targetLangRef.current = targetLang
    }
  }, [getLanguageByLangcode, isLanguagesLoaded])

  // Initialize values only once
  const initialize = useCallback(async () => {
    if (initialized) {
      logger.silly('[initialize] Already initialized.')
      return
    }

    // Only try to initialize when languages loaded, so updateTargetLanguage would not fail.
    if (!isLanguagesLoaded) {
      logger.silly('[initialize] Languages not loaded. Skip initialization.')
      return
    }

    // Edge case
    if (action.selectedText === undefined) {
      logger.error('[initialize] No selected text.')
      return
    }
    logger.silly('[initialize] Start initialization.')

    // Initialize target language.
    // It will update targetLangRef, so we could get latest target language in the following code
    await updateTargetLanguage()
    logger.silly('[initialize] updateTargetLanguage completed.')

    // Initialize assistant
    const currentAssistant = getDefaultTranslateAssistant(targetLangRef.current, action.selectedText)

    assistantRef.current = currentAssistant

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)
    setInitialized(true)
  }, [action.selectedText, initialized, isLanguagesLoaded, updateTargetLanguage])

  // Try to initialize when:
  // 1. action.selectedText change (generally will not)
  // 2. isLanguagesLoaded change (only initialize when languages loaded)
  // 3. updateTargetLanguage change (depend on translateLanguages and isLanguagesLoaded)
  useEffect(() => {
    initialize()
  }, [initialize])

  const fetchResult = useCallback(async () => {
    if (!assistantRef.current || !topicRef.current || !action.selectedText || !initialized) return

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

    const assistant = getDefaultTranslateAssistant(targetLanguage, action.selectedText)
    assistantRef.current = assistant
    logger.debug('process once')
    processMessages(assistant, topicRef.current, assistant.content, setAskId, onStream, onFinish, onError)
  }, [action, targetLanguage, scrollToBottom, initialized])

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

  const handleChangeLanguage = (newTargetLanguage: TranslateLanguage) => {
    if (!initialized) {
      return
    }
    setTargetLanguage(newTargetLanguage)
    targetLangRef.current = newTargetLanguage

    db.settings.put({ id: 'translate:target:language', value: newTargetLanguage.langCode })
  }

  const handlePause = () => {
    // FIXME: It doesn't work because abort signal is not set.
    logger.silly('Try to pause: ', { id: askId.current })
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
          <Tooltip placement="bottom" title={t('translate.target_language')} arrow>
            <LanguageSelect
              value={targetLanguage.langCode}
              style={{ minWidth: 100, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.target_language')}
              optionFilterProp="label"
              onChange={(value) => handleChangeLanguage(getLanguageByLangcode(value))}
              disabled={isStreaming}
            />
          </Tooltip>
          <Spacer />
          <OriginalHeader onClick={() => setShowOriginal(!showOriginal)}>
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={showOriginal ? 'expanded' : ''} />
          </OriginalHeader>
        </MenuContainer>
        {showOriginal && (
          <OriginalContent>
            {action.selectedText}{' '}
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
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  width: 100%;
`

const Result = styled.div`
  margin-top: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`

const OriginalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;
  padding: 4px 0;
  white-space: nowrap;

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
  margin-top: 8px;
  padding: 8px;
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

const Spacer = styled.div`
  flex-grow: 0.5;
`

export default ActionTranslate
