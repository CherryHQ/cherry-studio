import { useChat } from '@ai-sdk/react'
import { LoadingOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import db from '@renderer/databases'
import { useDetectLang, useLanguages } from '@renderer/hooks/translate'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useTemporaryTopic } from '@renderer/hooks/useTemporaryTopic'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { PartsProvider } from '@renderer/pages/home/Messages/Blocks'
import ExecutionStreamCollector from '@renderer/pages/home/Messages/ExecutionStreamCollector'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Assistant, TranslateLanguage } from '@renderer/types'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import { defaultLanguage } from '@shared/config/constant'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translate-languages'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { Dropdown } from 'antd'
import { ArrowRight, ChevronDown, CircleHelp, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { createGlobalStyle } from 'styled-components'

import WindowFooter from './WindowFooter'
interface Props {
  action: SelectionActionItem
  scrollToBottom: () => void
}

const logger = loggerService.withContext('ActionTranslate')

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()

  const [language] = usePreference('app.language')
  const { languages, getLanguage } = useLanguages()
  const isLanguagesLoaded = languages !== undefined
  const detectLanguage = useDetectLang()

  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(() => {
    const candidate = language || navigator.language || defaultLanguage
    const lang = getLanguage(candidate as TranslateLangCode)
    if (lang) {
      return lang
    }
    logger.warn('[initialize targetLanguage] Unknown language; fallback to zh-CN')
    return BUILTIN_LANGUAGE.zhCN as unknown as TranslateLanguage
  })

  const [alterLanguage, setAlterLanguage] = useState<TranslateLanguage>(
    BUILTIN_LANGUAGE.enUS as unknown as TranslateLanguage
  )
  const [detectedLanguage, setDetectedLanguage] = useState<TranslateLanguage | null>(null)
  const [actualTargetLanguage, setActualTargetLanguage] = useState<TranslateLanguage>(targetLanguage)

  const [detectError, setDetectError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeAssistant, setActiveAssistant] = useState<Assistant | null>(null)
  // Temporary in-memory topic leased for this translate session.
  const { topicId: temporaryTopicId, ready: isTopicReady } = useTemporaryTopic(activeAssistant?.id)

  // Use useRef for values that shouldn't trigger re-renders
  const targetLangRef = useRef(targetLanguage)

  // It's called only in initialization.
  // It will change target/alter language, so fetchResult will be triggered. Be careful!
  const updateLanguagePair = useCallback(async () => {
    // Only called is when languages loaded.
    // It ensure we could get right language from getLanguage.
    if (!isLanguagesLoaded) {
      logger.silly('[updateLanguagePair] Languages are not loaded. Skip.')
      return
    }

    const biDirectionLangPair = await db.settings.get({ id: 'translate:bidirectional:pair' })

    if (biDirectionLangPair && biDirectionLangPair.value[0]) {
      const targetLang = getLanguage(biDirectionLangPair.value[0])
      if (targetLang) {
        setTargetLanguage(targetLang)
        targetLangRef.current = targetLang
      }
    }

    if (biDirectionLangPair && biDirectionLangPair.value[1]) {
      const alterLang = getLanguage(biDirectionLangPair.value[1])
      if (alterLang) {
        setAlterLanguage(alterLang)
      }
    }
  }, [getLanguage, isLanguagesLoaded])

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

    // Initialize assistant — topic is leased asynchronously via useTemporaryTopic.
    const currentAssistant = await getDefaultTranslateAssistant(targetLangRef.current, action.selectedText)

    setActiveAssistant(currentAssistant)
    setInitialized(true)
  }, [action.selectedText, initialized, isLanguagesLoaded, updateLanguagePair])

  // Try to initialize when:
  // 1. action.selectedText change (generally will not)
  // 2. isLanguagesLoaded change (only initialize when languages loaded)
  // 3. updateLanguagePair change (depend on translateLanguages and isLanguagesLoaded)
  useEffect(() => {
    void initialize()
  }, [initialize])

  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const { sendMessage, stop: stopChat } = useChat<CherryUIMessage>({
    id: temporaryTopicId ?? 'pending-temp',
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (err) => {
      setIsPreparing(false)
      setCompletionError(err.message)
    }
  })

  // Primary `useChat` is trigger-only — chunks are tagged with the
  // execution's modelId by Main, so the per-execution collector below
  // owns the streaming content. One collector per `activeExecutionId`;
  // we read the streaming assistant message from its internal state.
  const { activeExecutions, isPending } = useTopicStreamStatus(temporaryTopicId ?? 'pending-temp')
  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose, resetExecutionMessages } =
    useExecutionMessages()

  const executionChats = useExecutionChats(temporaryTopicId ?? 'pending-temp', activeExecutions)

  // Flatten all collectors' assistant messages — in practice there's at
  // most one (single-model translate), but keep the shape generic in case
  // the session ever fans out.
  const latestAssistantUIMsg = useMemo<CherryUIMessage | undefined>(() => {
    for (const execMessages of Object.values(executionMessagesById)) {
      for (let i = execMessages.length - 1; i >= 0; i--) {
        if (execMessages[i].role === 'assistant') return execMessages[i]
      }
    }
    return undefined
  }, [executionMessagesById])

  useEffect(() => {
    if (isPending) {
      setIsPreparing(false)
      scrollToBottom?.()
    }
  }, [isPending, scrollToBottom])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(
    () =>
      latestAssistantUIMsg ? { [latestAssistantUIMsg.id]: latestAssistantUIMsg.parts as CherryMessagePart[] } : {},
    [latestAssistantUIMsg]
  )

  const latestAssistantMessage = useMemo(() => {
    if (!latestAssistantUIMsg) return null
    return {
      id: latestAssistantUIMsg.id,
      role: 'assistant' as const,
      assistantId: '',
      topicId: '',
      createdAt: '',
      status: isPending ? AssistantMessageStatus.PROCESSING : AssistantMessageStatus.SUCCESS,
      blocks: []
    }
  }, [latestAssistantUIMsg, isPending])

  const content = useMemo(
    () => (latestAssistantUIMsg ? getTextFromParts(latestAssistantUIMsg.parts as CherryMessagePart[]) : ''),
    [latestAssistantUIMsg]
  )

  const isStreaming = isPending
  const error = completionError

  const clear = useCallback(() => {
    void stopChat()
    resetExecutionMessages()
    setCompletionError(null)
    setIsPreparing(false)
  }, [stopChat, resetExecutionMessages])

  const fetchResult = useCallback(async () => {
    if (!isTopicReady || !temporaryTopicId || !action.selectedText || !initialized) return
    clear()
    setDetectError(null)

    let sourceLanguageCode: TranslateLangCode

    try {
      sourceLanguageCode = await detectLanguage(action.selectedText)
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'An error occurred')
      logger.error('Error detecting language:', err as Error)
      return
    }

    const detectedLang = getLanguage(sourceLanguageCode) ?? null
    setDetectedLanguage(detectedLang)

    let translateLang: TranslateLanguage

    if (sourceLanguageCode === UNKNOWN_LANG_CODE) {
      logger.debug('Unknown source language. Just use target language.')
      translateLang = targetLanguage
    } else {
      logger.debug('Detected Language: ', { sourceLanguage: sourceLanguageCode })
      translateLang = sourceLanguageCode === targetLanguage.langCode ? alterLanguage : targetLanguage
    }

    setActualTargetLanguage(translateLang)

    const assistant = await getDefaultTranslateAssistant(translateLang, action.selectedText)
    setActiveAssistant(assistant)
    logger.debug('Run translate action stream')

    setCompletionError(null)
    setIsPreparing(true)
    // topicId comes from useChat id; Main resolves assistant/model from topic.assistantId.
    void sendMessage({ text: assistant.content })
  }, [
    action,
    temporaryTopicId,
    isTopicReady,
    alterLanguage,
    clear,
    getLanguage,
    initialized,
    sendMessage,
    targetLanguage
  ])

  useEffect(() => {
    void fetchResult()
  }, [fetchResult])

  const handleChangeLanguage = useCallback(
    (newTargetLanguage: TranslateLanguage, newAlterLanguage: TranslateLanguage) => {
      if (!initialized) {
        return
      }
      setTargetLanguage(newTargetLanguage)
      targetLangRef.current = newTargetLanguage
      setAlterLanguage(newAlterLanguage)

      void db.settings.put({
        id: 'translate:bidirectional:pair',
        value: [newTargetLanguage.langCode, newAlterLanguage.langCode]
      })
    },
    [initialized]
  )

  // Handle direct target language change from the main dropdown
  const handleDirectTargetChange = useCallback(
    (langCode: TranslateLangCode) => {
      if (!initialized) return
      const newLang = getLanguage(langCode)
      if (!newLang) return
      setActualTargetLanguage(newLang)

      // Update settings: if new target equals current target, keep as is
      // Otherwise, swap if needed or just update target
      if (newLang.langCode !== targetLanguage.langCode && newLang.langCode !== alterLanguage.langCode) {
        // New language is different from both, update target
        setTargetLanguage(newLang)
        targetLangRef.current = newLang
        void db.settings.put({ id: 'translate:bidirectional:pair', value: [newLang.langCode, alterLanguage.langCode] })
      }
    },
    [initialized, getLanguage, targetLanguage.langCode, alterLanguage.langCode]
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
                const next = getLanguage(value)
                if (next) handleChangeLanguage(next, alterLanguage)
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
                const next = getLanguage(value)
                if (next) handleChangeLanguage(targetLanguage, next)
                setSettingsOpen(false)
              }}
              disabled={isStreaming}
            />
          </SettingsMenuItem>
        )
      }
    ],
    [t, targetLanguage, alterLanguage, isStreaming, getLanguage, handleChangeLanguage]
  )

  const handlePause = () => {
    void stopChat()
    if (temporaryTopicId) void pauseTrace(temporaryTopicId)
  }

  const handleRegenerate = () => {
    void fetchResult()
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
                  <span>{detectedLanguage?.value || t('translate.detected_source')}</span>
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
              <Tooltip content={t('translate.language_settings')} placement="bottom">
                <SettingsButton>
                  <Settings2 size={14} />
                </SettingsButton>
              </Tooltip>
            </Dropdown>

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
          {temporaryTopicId &&
            activeExecutions.map(({ executionId }) => {
              const execChat = executionChats.get(executionId)
              if (!execChat) return null
              return (
                <ExecutionStreamCollector
                  key={executionId}
                  executionId={executionId}
                  chat={execChat}
                  onMessagesChange={handleExecutionMessagesChange}
                  onDispose={handleExecutionDispose}
                />
              )
            })}
          {isPreparing && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {!isPreparing && latestAssistantMessage && (
            <PartsProvider value={partsMap}>
              <MessageContent key={latestAssistantMessage.id} message={latestAssistantMessage} />
            </PartsProvider>
          )}
        </Result>
        {(detectError || error) && <ErrorMsg>{detectError || error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
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
