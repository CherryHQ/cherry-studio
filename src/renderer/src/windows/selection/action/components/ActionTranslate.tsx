import { LoadingOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { UNKNOWN } from '@renderer/config/translate'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import useTranslate from '@renderer/hooks/useTranslate'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import { getDefaultTopic, getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import type { Assistant, Topic, TranslateAssistant, TranslateLanguageCode } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { detectLanguage } from '@renderer/utils/translate'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { ArrowRightFromLine, ArrowRightToLine, ChevronDown, CircleHelp, Globe } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'
interface Props {
  action: SelectionActionItem
  scrollToBottom: () => void
}

const logger = loggerService.withContext('ActionTranslate')

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()

  const [translateModelPrompt] = usePreference('feature.translate.model_prompt')
  const [targetLangs, setTargetLangs] = usePreference('translate.settings.target_langs')
  const { target: targetLanguage, alter: alterLanguage } = targetLangs

  const [error, setError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [isContented, setIsContented] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [contentToCopy, setContentToCopy] = useState('')
  const { getLanguageByLangcode } = useTranslate()

  // Use useRef for values that shouldn't trigger re-renders
  const initialized = useRef(false)
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const askId = useRef('')

  // Initialize values only once when action changes
  useEffect(() => {
    if (initialized.current || !action.selectedText) return
    initialized.current = true

    runAsyncFunction(async () => {
      // Initialize assistant
      let currentAssistant: TranslateAssistant
      try {
        currentAssistant = await getDefaultTranslateAssistant(
          getLanguageByLangcode(targetLanguage),
          action.selectedText!
        )
      } catch (e) {
        logger.error('Failed to initialize assistant', { targetLanguage, text: action.selectedText })
        return
      }
      assistantRef.current = currentAssistant

      // Initialize topic
      topicRef.current = getDefaultTopic(currentAssistant.id)
    })
  }, [action, getLanguageByLangcode, targetLanguage, translateModelPrompt])

  const fetchResult = useCallback(async () => {
    if (!assistantRef.current || !topicRef.current || !action.selectedText) return

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

    setIsLoading(true)

    let sourceLanguageCode: TranslateLanguageCode

    try {
      sourceLanguageCode = await detectLanguage(action.selectedText)
    } catch (err) {
      onError(err instanceof Error ? err : new Error('An error occurred'))
      logger.error('Error detecting language:', err as Error)
      return
    }

    let translateLang: TranslateLanguageCode

    if (sourceLanguageCode === UNKNOWN.langCode) {
      logger.debug('Unknown source language. Just use target language.')
      translateLang = targetLanguage
    } else {
      logger.debug('Detected Language: ', { sourceLanguage: sourceLanguageCode })
      if (sourceLanguageCode === targetLanguage) {
        translateLang = alterLanguage
      } else {
        translateLang = targetLanguage
      }
    }

    let assistant: TranslateAssistant
    try {
      assistant = await getDefaultTranslateAssistant(getLanguageByLangcode(translateLang), action.selectedText)
      assistantRef.current = assistant
    } catch (err) {
      onError(err instanceof Error ? err : new Error('An error occurred'))
      logger.error('Error when getting assistant:', err as Error)
      return
    }
    processMessages(assistant, topicRef.current, assistant.content, setAskId, onStream, onFinish, onError)
  }, [action.selectedText, getLanguageByLangcode, scrollToBottom, targetLanguage, alterLanguage])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const allMessages = useTopicMessages(topicRef.current?.id || '')

  const messageContent = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
    return lastAssistantMessage ? <MessageContent key={lastAssistantMessage.id} message={lastAssistantMessage} /> : null
  }, [allMessages])

  const handleChangeLanguage = (targetLanguage: TranslateLanguageCode, alterLanguage: TranslateLanguageCode) => {
    setTargetLangs({
      target: targetLanguage,
      alter: alterLanguage
    })
  }

  const handlePause = () => {
    if (askId.current) {
      abortCompletion(askId.current)
      setIsLoading(false)
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
          <Tooltip placement="bottom" content={t('translate.any.language')}>
            <Globe size={16} style={{ flexShrink: 0 }} />
          </Tooltip>
          <ArrowRightToLine size={16} color="var(--color-text-3)" style={{ margin: '0 2px' }} />
          <Tooltip placement="bottom" content={t('translate.target_language')}>
            <LanguageSelect
              value={targetLanguage}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.target_language')}
              optionFilterProp="label"
              onChange={(value) => handleChangeLanguage(value, alterLanguage)}
              disabled={isLoading}
            />
          </Tooltip>
          <ArrowRightFromLine size={16} color="var(--color-text-3)" style={{ margin: '0 2px' }} />
          <Tooltip placement="bottom" content={t('translate.alter_language')}>
            <LanguageSelect
              value={alterLanguage}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.alter_language')}
              optionFilterProp="label"
              onChange={(value) => handleChangeLanguage(targetLanguage, value)}
              disabled={isLoading}
            />
          </Tooltip>
          <Tooltip placement="bottom" content={t('selection.action.translate.smart_translate_tips')}>
            <QuestionIcon size={14} style={{ marginLeft: 4 }} />
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
          {!isContented && isLoading && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {messageContent}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isLoading} onPause={handlePause} onRegenerate={handleRegenerate} content={contentToCopy} />
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
const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

export default ActionTranslate
