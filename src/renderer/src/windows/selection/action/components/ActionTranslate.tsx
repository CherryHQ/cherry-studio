import { LoadingOutlined } from '@ant-design/icons'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipRoot,
  TooltipTrigger
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { UNKNOWN } from '@renderer/config/translate'
import { useDetectLang, useLanguages } from '@renderer/hooks/translate'
import { useTopicMessages } from '@renderer/hooks/useMessageOperations'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import { getDefaultTopic, getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import type { Assistant, Topic, TranslateLanguageVo } from '@renderer/types'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { ArrowRight, ChevronDown, CircleHelp, Settings2 } from 'lucide-react'
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

  const detectLanguage = useDetectLang()
  const { getLanguage, languages, getLabel } = useLanguages()
  const isLanguagesLoaded = languages !== undefined

  const [preferredLangCode, setPreferredLangCode] = usePreference('feature.translate.action.preferred_lang')
  const preferredLang = useMemo<TranslateLanguageVo>(() => {
    if (preferredLangCode === UNKNOWN.langCode) {
      return UNKNOWN
    } else {
      return getLanguage(preferredLangCode) ?? UNKNOWN
    }
  }, [preferredLangCode, getLanguage])

  const [alterLangCode, setAlterLangCode] = usePreference('feature.translate.action.alter_lang')
  const alterLang = useMemo<TranslateLanguageVo>(() => {
    if (alterLangCode === UNKNOWN.langCode) {
      return UNKNOWN
    } else {
      return getLanguage(alterLangCode) ?? UNKNOWN
    }
  }, [alterLangCode, getLanguage])

  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLanguageVo | null>(null)
  const [actualTargetLanguage, setActualTargetLanguage] = useState<TranslateLanguageVo>(preferredLang)

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

  // Mirror of preferred/alter for fetchResult to read at call time. Avoids
  // closure staleness *and* keeps fetchResult's identity stable so it doesn't
  // get re-triggered by deps cascade.
  const targetsRef = useRef({ preferred: preferredLang, alter: alterLang })
  useEffect(() => {
    targetsRef.current = { preferred: preferredLang, alter: alterLang }
  }, [preferredLang, alterLang])

  // Track the displayed target with the preferred language until fetchResult
  // resolves the actual translate target, so the dropdown does not flash UNKNOWN
  // before useLanguages loads.
  useEffect(() => {
    if (status === 'preparing') {
      setActualTargetLanguage(preferredLang)
    }
  }, [preferredLang, status])

  const fetchResult = useCallback(
    // overrideTarget bypasses the smart preferred/alter swap when the user
    // explicitly picked a target from the dropdown.
    async (overrideTarget?: TranslateLanguageVo) => {
      if (!assistantRef.current || !topicRef.current || !action.selectedText) return

      // Reset UI state immediately so the user sees instant feedback.
      setStatus('preparing')
      setError('')
      setContentToCopy('')

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

      let sourceLanguageCode: TranslateLangCode

      try {
        sourceLanguageCode = await detectLanguage(action.selectedText)
      } catch (err) {
        onError(err instanceof Error ? err : new Error('An error occurred'))
        logger.error('Error detecting language:', err as Error)
        return
      }

      const detectedLang = getLanguage(sourceLanguageCode) ?? UNKNOWN
      setDetectedLanguage(detectedLang)

      const { preferred, alter } = targetsRef.current
      let translateLang: TranslateLanguageVo

      if (overrideTarget) {
        translateLang = overrideTarget
      } else if (sourceLanguageCode === UNKNOWN.langCode) {
        logger.debug('Unknown source language. Just use preferred target.')
        translateLang = preferred
      } else {
        logger.debug('Detected Language: ', { sourceLanguage: sourceLanguageCode })
        translateLang = sourceLanguageCode === preferred.langCode ? alter : preferred
      }

      setActualTargetLanguage(translateLang)

      const assistant = await getDefaultTranslateAssistant(translateLang, action.selectedText)
      assistantRef.current = assistant
      processMessages(assistant, topicRef.current, assistant.content, setAskId, onStream, onFinish, onError).catch(
        (e) => onError(e instanceof Error ? e : new Error(String(e)))
      )
    },
    [action, scrollToBottom, getLanguage, detectLanguage]
  )

  // First-time initialization: build assistant/topic once languages are ready,
  // then kick off the first translation. All later runs are event-driven.
  const initialize = useCallback(async () => {
    if (initialized || !isLanguagesLoaded) return

    if (action.selectedText === undefined) {
      logger.error('[initialize] No selected text.')
      setError(t('selection.action.translate.error.no_selected_text'))
      setStatus('finished')
      return
    }

    const currentAssistant = await getDefaultTranslateAssistant(preferredLang, action.selectedText)
    assistantRef.current = currentAssistant
    topicRef.current = getDefaultTopic(currentAssistant.id)
    setInitialized(true)
    void fetchResult()
  }, [action.selectedText, initialized, isLanguagesLoaded, preferredLang, t, fetchResult])

  useEffect(() => {
    void initialize()
  }, [initialize])

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
    (newTargetLanguage: TranslateLanguageVo, newAlterLanguage: TranslateLanguageVo) => {
      if (!initialized) {
        return
      }
      if (newTargetLanguage.langCode === UNKNOWN.langCode || newAlterLanguage.langCode === UNKNOWN.langCode) {
        logger.warn('Refusing to persist UNKNOWN language code', {
          target: newTargetLanguage.langCode,
          alter: newAlterLanguage.langCode
        })
        return
      }
      void setPreferredLangCode(newTargetLanguage.langCode)
      void setAlterLangCode(newAlterLanguage.langCode)
      // Sync ref so fetchResult sees the new pair immediately, before the
      // preference IPC writes round-trip back into state.
      targetsRef.current = { preferred: newTargetLanguage, alter: newAlterLanguage }
      void fetchResult()
    },
    [initialized, setPreferredLangCode, setAlterLangCode, fetchResult]
  )

  // Handle direct target language change from the main dropdown
  const handleDirectTargetChange = useCallback(
    (langCode: TranslateLangCode) => {
      if (!initialized) return
      const newLang = getLanguage(langCode)
      if (!newLang || newLang.langCode === UNKNOWN.langCode) {
        logger.warn('Refusing to set UNKNOWN as target language', { langCode })
        return
      }
      setActualTargetLanguage(newLang)
      // Persist only when the pick differs from both saved slots; otherwise the
      // user is just temporarily flipping target for this run.
      if (newLang.langCode !== preferredLang.langCode && newLang.langCode !== alterLang.langCode) {
        targetsRef.current = { ...targetsRef.current, preferred: newLang }
        void setPreferredLangCode(newLang.langCode)
      }
      // overrideTarget makes fetchResult skip the smart swap and translate to
      // exactly what the user picked.
      void fetchResult(newLang)
    },
    [initialized, getLanguage, preferredLang.langCode, alterLang.langCode, setPreferredLangCode, fetchResult]
  )

  const settingsContent = useMemo(
    () => (
      <div className="flex flex-col gap-3">
        <SettingsMenuItem>
          <SettingsLabel>{t('translate.preferred_target')}</SettingsLabel>
          <LanguageSelect
            value={preferredLang.langCode}
            style={{ width: '100%' }}
            listHeight={160}
            size="small"
            onChange={(value: TranslateLangCode) => {
              handleChangeLanguage(getLanguage(value) ?? UNKNOWN, alterLang)
              setSettingsOpen(false)
            }}
            disabled={isStreaming}
          />
        </SettingsMenuItem>
        <SettingsMenuItem>
          <SettingsLabel>{t('translate.alter_language')}</SettingsLabel>
          <LanguageSelect
            value={alterLang.langCode}
            style={{ width: '100%' }}
            listHeight={160}
            size="small"
            onChange={(value) => {
              handleChangeLanguage(preferredLang, getLanguage(value) ?? UNKNOWN)
              setSettingsOpen(false)
            }}
            disabled={isStreaming}
          />
        </SettingsMenuItem>
      </div>
    ),
    [t, preferredLang, alterLang, isStreaming, getLanguage, handleChangeLanguage]
  )

  const handlePause = () => {
    // FIXME: It doesn't work because abort signal is not set.
    logger.silly('Try to pause: ', { id: askId.current })
    if (askId.current) {
      abortCompletion(askId.current)
    }
    if (topicRef.current?.id) {
      void pauseTrace(topicRef.current.id)
    }
  }

  const handleRegenerate = () => {
    void fetchResult()
  }

  return (
    <>
      <Container>
        <MenuContainer>
          <LeftGroup>
            {/* Detected language display (read-only) */}
            <DetectedLanguageTag>
              {isPreparing ? (
                <span>{t('translate.detecting')}</span>
              ) : (
                <>
                  <span>{getLabel(detectedLanguage) || t('translate.detected_source')}</span>
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

            {/* Settings popover (Tooltip + Popover share the same trigger via nested asChild) */}
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <SettingsButton aria-label={t('translate.language_settings')}>
                      <Settings2 size={14} />
                    </SettingsButton>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('translate.language_settings')}</TooltipContent>
              </TooltipRoot>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="w-56 p-3"
                onInteractOutside={(e) => {
                  // Keep open while interacting with antd Select popups (rendered in a separate portal)
                  const target = e.target as Element | null
                  if (target?.closest('.ant-select-dropdown')) {
                    e.preventDefault()
                  }
                }}>
                {settingsContent}
              </PopoverContent>
            </Popover>

            <Tooltip content={t('selection.action.translate.smart_translate_tips')} placement="bottom">
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

export default ActionTranslate
