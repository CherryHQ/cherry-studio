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
import type { Assistant, Topic, TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { detectLanguage } from '@renderer/utils/translate'
import { Tooltip } from 'antd'
import { ArrowRightFromLine, ArrowRightToLine, ChevronDown, CircleHelp, Globe } from 'lucide-react'
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

  const [alterLanguage, setAlterLanguage] = useState<TranslateLanguage>(LanguagesEnum.enUS)

  const [error, setError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [isContented, setIsContented] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [contentToCopy, setContentToCopy] = useState('')

  // Use useRef for values that shouldn't trigger re-renders
  const initialized = useRef(false)
  const assistantRef = useRef<Assistant | null>(null)
  const topicRef = useRef<Topic | null>(null)
  const askId = useRef('')
  const targetLangRef = useRef(targetLanguage)

  // It's called only in initialization.
  // It will change target/alter language, so fetchResult will be triggered. Be careful!
  const updateLanguagePair = useCallback(async () => {
    // Only called is when languages loaded.
    // It ensure we could get right language from getLanguageByLangcode.
    if (!isLanguagesLoaded) {
      logger.silly('[updateLanguagePair] Languages are not loaded. Skip.')
      return
    }

    const biDirectionLangPair = await db.settings.get({ id: 'translate:bidirectional:pair' })

    if (biDirectionLangPair && biDirectionLangPair.value[0]) {
      const targetLang = getLanguageByLangcode(biDirectionLangPair.value[0])
      setTargetLanguage(targetLang)
      targetLangRef.current = targetLang
    }

    if (biDirectionLangPair && biDirectionLangPair.value[1]) {
      const alterLang = getLanguageByLangcode(biDirectionLangPair.value[1])
      setAlterLanguage(alterLang)
    }
  }, [getLanguageByLangcode, isLanguagesLoaded])

  // Initialize values only once
  const initialize = useCallback(async () => {
    if (initialized.current) {
      logger.silly('[initialize] Already initialized.')
      return
    }

    // Only try to initialize when languages loaded, so updateLanguagePair would not fail.
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

    // Initialize language pair.
    // It will update targetLangRef, so we could get latest target language in the following code
    await updateLanguagePair()

    // Initialize assistant
    const currentAssistant = getDefaultTranslateAssistant(targetLangRef.current, action.selectedText)

    assistantRef.current = currentAssistant

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)
    initialized.current = true
  }, [action.selectedText, isLanguagesLoaded, updateLanguagePair])

  // Try to initialize when:
  // 1. action.selectedText change (generally will not)
  // 2. isLanguagesLoaded change (only initialize when languages loaded)
  // 3. updateLanguagePair change (depend on translateLanguages and isLanguagesLoaded)
  useEffect(() => {
    initialize()
  }, [initialize])

  const fetchResult = useCallback(async () => {
    if (!assistantRef.current || !topicRef.current || !action.selectedText || !initialized.current) return

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

    let translateLang: TranslateLanguage

    if (sourceLanguageCode === UNKNOWN.langCode) {
      logger.debug('Unknown source language. Just use target language.')
      translateLang = targetLanguage
    } else {
      logger.debug('Detected Language: ', { sourceLanguage: sourceLanguageCode })
      if (sourceLanguageCode === targetLanguage.langCode) {
        translateLang = alterLanguage
      } else {
        translateLang = targetLanguage
      }
    }

    const assistant = getDefaultTranslateAssistant(translateLang, action.selectedText)
    assistantRef.current = assistant
    logger.debug('process once')
    processMessages(assistant, topicRef.current, assistant.content, setAskId, onStream, onFinish, onError)
  }, [action, targetLanguage, alterLanguage, scrollToBottom])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const allMessages = useTopicMessages(topicRef.current?.id || '')

  const messageContent = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
    return lastAssistantMessage ? <MessageContent key={lastAssistantMessage.id} message={lastAssistantMessage} /> : null
  }, [allMessages])

  const handleChangeLanguage = (targetLanguage: TranslateLanguage, alterLanguage: TranslateLanguage) => {
    if (!initialized.current) {
      return
    }
    setTargetLanguage(targetLanguage)
    targetLangRef.current = targetLanguage
    setAlterLanguage(alterLanguage)

    db.settings.put({ id: 'translate:bidirectional:pair', value: [targetLanguage.langCode, alterLanguage.langCode] })
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
          <Tooltip placement="bottom" title={t('translate.any.language')} arrow>
            <Globe size={16} style={{ flexShrink: 0 }} />
          </Tooltip>
          <ArrowRightToLine size={16} color="var(--color-text-3)" style={{ margin: '0 2px' }} />
          <Tooltip placement="bottom" title={t('translate.target_language')} arrow>
            <LanguageSelect
              value={targetLanguage.langCode}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.target_language')}
              optionFilterProp="label"
              onChange={(value) => handleChangeLanguage(getLanguageByLangcode(value), alterLanguage)}
              disabled={isLoading}
            />
          </Tooltip>
          <ArrowRightFromLine size={16} color="var(--color-text-3)" style={{ margin: '0 2px' }} />
          <Tooltip placement="bottom" title={t('translate.alter_language')} arrow>
            <LanguageSelect
              value={alterLanguage.langCode}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.alter_language')}
              optionFilterProp="label"
              onChange={(value) => handleChangeLanguage(targetLanguage, getLanguageByLangcode(value))}
              disabled={isLoading}
            />
          </Tooltip>
          <Tooltip placement="bottom" title={t('selection.action.translate.smart_translate_tips')} arrow>
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
