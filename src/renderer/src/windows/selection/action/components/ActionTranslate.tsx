import { LoadingOutlined } from '@ant-design/icons'
import CopyButton from '@renderer/components/CopyButton'
import { LanguagesEnum, translateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import {
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic,
  getTranslateModel
} from '@renderer/services/AssistantService'
import { Assistant, Language, Topic } from '@renderer/types'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { runAsyncFunction } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { detectLanguage, getLanguageByLangcode } from '@renderer/utils/translate'
import { Select, Space, Tooltip } from 'antd'
import { ArrowRightFromLine, ArrowRightToLine, ChevronDown, CircleHelp, Globe } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { processMessages } from './ActionUtils'
import WindowFooter from './WindowFooter'
interface Props {
  action: ActionItem
  scrollToBottom: () => void
}

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { translateModelPrompt, language } = useSettings()

  const [targetLanguage, setTargetLanguage] = useState<Language>(LanguagesEnum.enUS)
  const [alterLanguage, setAlterLanguage] = useState<Language>(LanguagesEnum.zhCN)

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

  useEffect(() => {
    runAsyncFunction(async () => {
      const biDirectionLangPair = await db.settings.get({ id: 'translate:bidirectional:pair' })

      let targetLang: Language
      let alterLang: Language

      if (!biDirectionLangPair || !biDirectionLangPair.value[0]) {
        const lang = translateLanguageOptions.find((lang) => lang.langCode?.toLowerCase() === language.toLowerCase())
        if (lang) {
          targetLang = lang
        } else {
          targetLang = LanguagesEnum.zhCN
        }
      } else {
        targetLang = getLanguageByLangcode(biDirectionLangPair.value[0])
      }

      if (!biDirectionLangPair || !biDirectionLangPair.value[1]) {
        alterLang = LanguagesEnum.enUS
      } else {
        alterLang = getLanguageByLangcode(biDirectionLangPair.value[1])
      }

      setTargetLanguage(targetLang)
      setAlterLanguage(alterLang)
    })
  }, [language])

  // Initialize values only once when action changes
  useEffect(() => {
    if (initialized.current || !action.selectedText) return
    initialized.current = true

    // Initialize assistant
    const currentAssistant = getDefaultAssistant()
    const translateModel = getTranslateModel() || getDefaultModel()

    currentAssistant.model = translateModel
    currentAssistant.settings = {
      temperature: 0.7
    }

    assistantRef.current = currentAssistant

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)
  }, [action, targetLanguage, translateModelPrompt])

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

    const sourceLanguage = await detectLanguage(action.selectedText)

    let translateLang: Language
    if (sourceLanguage.langCode === targetLanguage.langCode) {
      translateLang = alterLanguage
    } else {
      translateLang = targetLanguage
    }

    // Initialize prompt content
    const userContent = translateModelPrompt
      .replaceAll('{{target_language}}', translateLang.value)
      .replaceAll('{{text}}', action.selectedText)

    processMessages(assistantRef.current, topicRef.current, userContent, setAskId, onStream, onFinish, onError)
  }, [action, targetLanguage, alterLanguage, translateModelPrompt, scrollToBottom])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const allMessages = useTopicMessages(topicRef.current?.id || '')

  const messageContent = useMemo(() => {
    const assistantMessages = allMessages.filter((message) => message.role === 'assistant')
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
    return lastAssistantMessage ? <MessageContent key={lastAssistantMessage.id} message={lastAssistantMessage} /> : null
  }, [allMessages])

  const handleChangeLanguage = (targetLanguage: Language, alterLanguage: Language) => {
    setTargetLanguage(targetLanguage)
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
            <Select
              value={targetLanguage.langCode}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.target_language')}
              optionFilterProp="label"
              options={translateLanguageOptions.map((lang) => ({
                value: lang.langCode,
                label: (
                  <Space.Compact direction="horizontal" block>
                    <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                      {lang.emoji}
                    </span>
                    <Space.Compact block>{lang.label()}</Space.Compact>
                  </Space.Compact>
                )
              }))}
              onChange={(value) => handleChangeLanguage(getLanguageByLangcode(value), alterLanguage)}
              disabled={isLoading}
            />
          </Tooltip>
          <ArrowRightFromLine size={16} color="var(--color-text-3)" style={{ margin: '0 2px' }} />
          <Tooltip placement="bottom" title={t('translate.alter_language')} arrow>
            <Select
              value={alterLanguage.langCode}
              style={{ minWidth: 80, maxWidth: 200, flex: 'auto' }}
              listHeight={160}
              title={t('translate.alter_language')}
              optionFilterProp="label"
              options={translateLanguageOptions.map((lang) => ({
                value: lang.langCode,
                label: (
                  <Space.Compact direction="horizontal" block>
                    <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                      {lang.emoji}
                    </span>
                    <Space.Compact block>{lang.label()}</Space.Compact>
                  </Space.Compact>
                )
              }))}
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
