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
import type { Assistant, Topic, TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { abortCompletion } from '@renderer/utils/abortController'
import { detectLanguage } from '@renderer/utils/translate'
import { Dropdown, Tooltip } from 'antd'
import { ArrowRight, ChevronDown, CircleHelp, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { createGlobalStyle } from 'styled-components'

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
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLanguage | null>(null)
  const [actualTargetLanguage, setActualTargetLanguage] = useState<TranslateLanguage>(targetLanguage)

  const [error, setError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)
  const [status, setStatus] = useState<'preparing' | 'streaming' | 'finished'>('preparing')
  const [contentToCopy, setContentToCopy] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Use useRef for values that shouldn't trigger re-renders
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
    if (initialized) {
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
    logger.silly('[initialize] UpdateLanguagePair completed.')

    // Initialize assistant
    const currentAssistant = getDefaultTranslateAssistant(targetLangRef.current, action.selectedText)

    assistantRef.current = currentAssistant

    // Initialize topic
    topicRef.current = getDefaultTopic(currentAssistant.id)
    setInitialized(true)
  }, [action.selectedText, initialized, isLanguagesLoaded, updateLanguagePair])

  // Try to initialize when:
  // 1. action.selectedText change (generally will not)
  // 2. isLanguagesLoaded change (only initialize when languages loaded)
  // 3. updateLanguagePair change (depend on translateLanguages and isLanguagesLoaded)
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

    let sourceLanguageCode: TranslateLanguageCode

    try {
      sourceLanguageCode = await detectLanguage(action.selectedText)
    } catch (err) {
      onError(err instanceof Error ? err : new Error('An error occurred'))
      logger.error('Error detecting language:', err as Error)
      return
    }

    // Set detected language for UI display
    const detectedLang = getLanguageByLangcode(sourceLanguageCode)
    setDetectedLanguage(detectedLang)

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

    // Set actual target language for UI display
    setActualTargetLanguage(translateLang)

    const assistant = getDefaultTranslateAssistant(translateLang, action.selectedText)
    assistantRef.current = assistant
    logger.debug('process once')
    processMessages(assistant, topicRef.current, assistant.content, setAskId, onStream, onFinish, onError)
  }, [action, targetLanguage, alterLanguage, scrollToBottom, initialized, getLanguageByLangcode])

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

  const handleChangeLanguage = useCallback(
    (newTargetLanguage: TranslateLanguage, newAlterLanguage: TranslateLanguage) => {
      if (!initialized) {
        return
      }
      setTargetLanguage(newTargetLanguage)
      targetLangRef.current = newTargetLanguage
      setAlterLanguage(newAlterLanguage)

      db.settings.put({
        id: 'translate:bidirectional:pair',
        value: [newTargetLanguage.langCode, newAlterLanguage.langCode]
      })
    },
    [initialized]
  )

  // Handle direct target language change from the main dropdown
  const handleDirectTargetChange = useCallback(
    (langCode: TranslateLanguageCode) => {
      if (!initialized) return
      const newLang = getLanguageByLangcode(langCode)
      setActualTargetLanguage(newLang)

      // Update settings: if new target equals current target, keep as is
      // Otherwise, swap if needed or just update target
      if (newLang.langCode !== targetLanguage.langCode && newLang.langCode !== alterLanguage.langCode) {
        // New language is different from both, update target
        setTargetLanguage(newLang)
        targetLangRef.current = newLang
        db.settings.put({ id: 'translate:bidirectional:pair', value: [newLang.langCode, alterLanguage.langCode] })
      }
    },
    [initialized, getLanguageByLangcode, targetLanguage.langCode, alterLanguage.langCode]
  )

  // Settings dropdown menu items
  const settingsMenuItems = useMemo(
    () => [
      {
        key: 'preferred',
        label: (
          <SettingsMenuItem>
            <SettingsLabel>{t('translate.preferred_target')}</SettingsLabel>
            <LanguageSelect
              value={targetLanguage.langCode}
              style={{ width: '100%' }}
              listHeight={160}
              size="small"
              onClick={(e) => e.stopPropagation()}
              onChange={(value) => {
                handleChangeLanguage(getLanguageByLangcode(value), alterLanguage)
                setSettingsOpen(false)
              }}
              disabled={isStreaming}
            />
          </SettingsMenuItem>
        )
      },
      {
        key: 'alter',
        label: (
          <SettingsMenuItem>
            <SettingsLabel>{t('translate.alter_language')}</SettingsLabel>
            <LanguageSelect
              value={alterLanguage.langCode}
              style={{ width: '100%' }}
              listHeight={160}
              size="small"
              onClick={(e) => e.stopPropagation()}
              onChange={(value) => {
                handleChangeLanguage(targetLanguage, getLanguageByLangcode(value))
                setSettingsOpen(false)
              }}
              disabled={isStreaming}
            />
          </SettingsMenuItem>
        )
      }
    ],
    [t, targetLanguage, alterLanguage, isStreaming, getLanguageByLangcode, handleChangeLanguage]
  )

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
      <SettingsDropdownStyles />
      <Container>
        <MenuContainer>
          <LeftGroup>
            {/* Detected language display (read-only) */}
            <DetectedLanguageTag>
              {isPreparing ? (
                <span>{t('translate.detecting')}</span>
              ) : (
                <>
                  <span style={{ marginRight: 4 }}>{detectedLanguage?.emoji || '🌐'}</span>
                  <span>{detectedLanguage?.label() || t('translate.detected_source')}</span>
                </>
              )}
            </DetectedLanguageTag>

            <ArrowRight size={16} color="var(--color-text-3)" style={{ flexShrink: 0 }} />

            {/* Target language selector */}
            <LanguageSelect
              value={actualTargetLanguage.langCode}
              style={{ minWidth: 100, maxWidth: 160 }}
              listHeight={160}
              size="small"
              optionFilterProp="label"
              onChange={handleDirectTargetChange}
              disabled={isStreaming}
            />

            {/* Settings dropdown */}
            <Dropdown
              menu={{
                items: settingsMenuItems,
                selectable: false,
                className: 'settings-dropdown-menu'
              }}
              trigger={['click']}
              placement="bottomRight"
              open={settingsOpen}
              onOpenChange={setSettingsOpen}>
              <Tooltip title={t('translate.language_settings')} placement="bottom">
                <SettingsButton>
                  <Settings2 size={14} />
                </SettingsButton>
              </Tooltip>
            </Dropdown>

            <Tooltip title={t('selection.action.translate.smart_translate_tips')} placement="bottom">
              <HelpIcon size={14} />
            </Tooltip>
          </LeftGroup>

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

const LeftGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 1;
  min-width: 0;
`

const DetectedLanguageTag = styled.div`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background-color: var(--color-background-soft);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
`

const SettingsButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  flex-shrink: 0;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text);
  }
`

const SettingsMenuItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
  min-width: 180px;
  cursor: default;
`

const SettingsLabel = styled.span`
  font-size: 12px;
  color: var(--color-text-secondary);
`

const HelpIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
  flex-shrink: 0;
`

const SettingsDropdownStyles = createGlobalStyle`
  .settings-dropdown-menu {
    .ant-dropdown-menu-item {
      cursor: default !important;
      &:hover {
        background-color: transparent !important;
      }
    }
  }
`

export default ActionTranslate
