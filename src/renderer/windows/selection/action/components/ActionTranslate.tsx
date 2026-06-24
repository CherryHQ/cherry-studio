import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { MessageContent, MessageContentProvider, toMessageListItem } from '@renderer/components/chat/messages'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { useDetectLang, useLanguages, useTranslate } from '@renderer/hooks/translate'
import type { TranslateLanguage } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { defaultLanguage } from '@shared/utils/languages'
import { ArrowRight, ChevronDown, CircleHelp, Globe2, Loader2, Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import WindowFooter from './WindowFooter'
interface Props {
  action: SelectionActionItem
  scrollToBottom: () => void
}

const logger = loggerService.withContext('ActionTranslate')
const TRANSLATION_MESSAGE_ID = 'selection-translation-result'
const TRANSLATION_TOPIC_ID = 'selection-translation'

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()
  const selectedText = action.selectedText

  const [language] = usePreference('app.language')
  const [preferredLangCode, setPreferredLangCode] = usePreference('feature.translate.action.preferred_lang')
  const [alterLangCode, setAlterLangCode] = usePreference('feature.translate.action.alter_lang')
  const { languages, getLanguage } = useLanguages()
  const isLanguagesLoaded = languages !== undefined
  const detectLanguage = useDetectLang()

  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(() => {
    const candidate = language || navigator.language || defaultLanguage
    const lang = getLanguage(candidate)
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
  const [content, setContent] = useState('')

  // Use useRef for values that shouldn't trigger re-renders
  const targetLangRef = useRef(targetLanguage)

  // It's called only in initialization.
  // It will change target/alter language, so fetchResult will be triggered. Be careful!
  const updateLanguagePair = useCallback(() => {
    if (!isLanguagesLoaded) {
      logger.silly('[updateLanguagePair] Languages are not loaded. Skip.')
      return
    }

    const targetLang = getLanguage(preferredLangCode)
    if (targetLang) {
      setTargetLanguage(targetLang)
      targetLangRef.current = targetLang
    }

    const alterLang = getLanguage(alterLangCode)
    if (alterLang) {
      setAlterLanguage(alterLang)
    }
  }, [getLanguage, isLanguagesLoaded, preferredLangCode, alterLangCode])

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
    if (selectedText === undefined) {
      logger.error('[initialize] No selected text.')
      return
    }
    logger.silly('[initialize] Start initialization.')

    updateLanguagePair()
    logger.silly('[initialize] UpdateLanguagePair completed.')

    setInitialized(true)
  }, [initialized, isLanguagesLoaded, selectedText, updateLanguagePair])

  // Try to initialize when:
  // 1. action.selectedText change (generally will not)
  // 2. isLanguagesLoaded change (only initialize when languages loaded)
  // 3. updateLanguagePair change (depend on translateLanguages and isLanguagesLoaded)
  useEffect(() => {
    void initialize()
  }, [initialize])

  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const {
    translate: runTranslate,
    isTranslating,
    cancel: cancelTranslate
  } = useTranslate({
    loggerContext: 'ActionTranslate',
    showErrorToast: false,
    rethrowError: true,
    onResponse: (text) => {
      setIsPreparing(false)
      setContent(text)
      scrollToBottom?.()
    }
  })

  const translationParts = useMemo<CherryMessagePart[]>(
    () => (content ? [{ type: 'text', text: content } as CherryMessagePart] : []),
    [content]
  )

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(
    () => ({ [TRANSLATION_MESSAGE_ID]: translationParts }),
    [translationParts]
  )

  const latestAssistantMessage = useMemo(() => {
    return toMessageListItem(
      {
        id: TRANSLATION_MESSAGE_ID,
        role: 'assistant',
        parts: translationParts,
        metadata: {
          status: isTranslating ? 'pending' : 'success'
        }
      } as CherryUIMessage,
      { topicId: TRANSLATION_TOPIC_ID }
    )
  }, [isTranslating, translationParts])

  const isStreaming = isTranslating || isPreparing
  const error = completionError

  const clear = useCallback(() => {
    cancelTranslate()
    setContent('')
    setCompletionError(null)
    setIsPreparing(false)
  }, [cancelTranslate])

  const fetchResult = useCallback(async () => {
    if (!selectedText || !initialized) return
    clear()
    setDetectError(null)

    let sourceLanguageCode: TranslateLangCode

    try {
      sourceLanguageCode = await detectLanguage(selectedText)
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

    setCompletionError(null)
    setIsPreparing(true)

    try {
      await runTranslate(selectedText, translateLang)
    } catch (err) {
      setContent('')
      const message = err instanceof Error ? err.message : String(err)
      setCompletionError(t(message, message))
    } finally {
      setIsPreparing(false)
    }
  }, [selectedText, initialized, clear, detectLanguage, getLanguage, alterLanguage, targetLanguage, runTranslate, t])

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

      void setPreferredLangCode(newTargetLanguage.langCode)
      void setAlterLangCode(newAlterLanguage.langCode)
    },
    [initialized, setPreferredLangCode, setAlterLangCode]
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
        void setPreferredLangCode(newLang.langCode)
      }
    },
    [initialized, getLanguage, targetLanguage.langCode, alterLanguage.langCode, setPreferredLangCode]
  )

  // Settings popover content
  const settingsContent = useMemo(
    () => (
      <div className="flex flex-col gap-2">
        <div className="flex min-w-[180px] cursor-default flex-col gap-1.5 py-1">
          <span className="text-foreground-secondary text-xs">{t('translate.preferred_target')}</span>
          <LanguageSelect
            value={targetLanguage.langCode}
            className="w-full"
            listHeight={160}
            size="small"
            onChange={(value) => {
              const next = getLanguage(value)
              if (next) handleChangeLanguage(next, alterLanguage)
              setSettingsOpen(false)
            }}
            disabled={isTranslating}
          />
        </div>
        <div className="flex min-w-[180px] cursor-default flex-col gap-1.5 py-1">
          <span className="text-foreground-secondary text-xs">{t('translate.alter_language')}</span>
          <LanguageSelect
            value={alterLanguage.langCode}
            className="w-full"
            listHeight={160}
            size="small"
            onChange={(value) => {
              const next = getLanguage(value)
              if (next) handleChangeLanguage(targetLanguage, next)
              setSettingsOpen(false)
            }}
            disabled={isTranslating}
          />
        </div>
      </div>
    ),
    [t, targetLanguage, alterLanguage, isTranslating, getLanguage, handleChangeLanguage]
  )

  const handlePause = () => {
    cancelTranslate()
    setIsPreparing(false)
  }

  const handleRegenerate = () => {
    void fetchResult()
  }

  return (
    <>
      <div className="flex w-full flex-1 flex-col items-center">
        <div className="flex w-full flex-row items-center justify-between">
          <div className="flex min-w-0 shrink items-center gap-1.5">
            {/* Detected language display (read-only) */}
            <div className="flex shrink-0 items-center whitespace-nowrap rounded bg-muted px-2 py-1 text-foreground-secondary text-xs">
              {isPreparing ? (
                <span>{t('translate.detecting')}</span>
              ) : (
                <>
                  <span className="mr-1">
                    {detectedLanguage?.emoji || <Globe2 className="inline size-3.5 align-[-2px]" />}
                  </span>
                  <span>{detectedLanguage?.value || t('translate.detected_source')}</span>
                </>
              )}
            </div>

            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />

            {/* Target language selector */}
            <LanguageSelect
              value={actualTargetLanguage.langCode}
              className="min-w-[100px] max-w-[160px]"
              listHeight={160}
              size="small"
              optionFilterProp="label"
              onChange={handleDirectTargetChange}
              disabled={isStreaming}
            />

            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Tooltip content={t('translate.language_settings')} placement="bottom">
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0 rounded text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                    <Settings2 size={14} />
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent align="end" className="w-[220px] p-2">
                {settingsContent}
              </PopoverContent>
            </Popover>

            <Tooltip content={t('selection.action.translate.smart_translate_tips')} placement="bottom">
              <CircleHelp className="size-3.5 shrink-0 cursor-pointer text-muted-foreground" />
            </Tooltip>
          </div>

          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex cursor-pointer items-center justify-between whitespace-nowrap py-1 text-foreground-secondary text-xs transition-colors hover:text-primary">
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={cn('transition-transform', showOriginal && 'rotate-180')} />
          </button>
        </div>
        {showOriginal && (
          <div className="mt-2 w-full whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground-secondary text-xs">
            {action.selectedText}{' '}
            <div className="flex justify-end">
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </div>
          </div>
        )}
        <div className="mt-4 w-full whitespace-pre-wrap break-words">
          {isPreparing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {content && (
            <MessageContentProvider
              messages={[latestAssistantMessage]}
              partsByMessageId={partsMap}
              renderConfig={renderConfig}
              actions={platformActions}>
              <MessageContent key={latestAssistantMessage.id} message={latestAssistantMessage} />
            </MessageContentProvider>
          )}
        </div>
        {(detectError || error) && (
          <div className="mb-3 break-all rounded border border-error-border bg-error-bg px-3 py-2 text-[13px] text-error-text">
            {detectError || error}
          </div>
        )}
      </div>
      <div className="min-h-3" />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
    </>
  )
}

export default ActionTranslate
