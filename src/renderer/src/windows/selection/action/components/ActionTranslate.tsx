import { LoadingOutlined } from '@ant-design/icons'
import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import LanguageSelect from '@renderer/components/LanguageSelect'
import db from '@renderer/databases'
import { useDetectLang, useLanguages, useTranslate } from '@renderer/hooks/translate'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { TranslateLanguage } from '@renderer/types'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import { defaultLanguage } from '@shared/config/constant'
import type { SelectionActionItem, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translate-languages'
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
  const [isPreparing, setIsPreparing] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const targetLangRef = useRef(targetLanguage)

  const { reset: smoothReset, update: smoothUpdate } = useSmoothStream({
    onUpdate: (text) => {
      setIsPreparing(false)
      setContent(text)
    }
  })

  const {
    translate: runTranslate,
    isTranslating,
    cancel: cancelTranslate
  } = useTranslate({
    loggerContext: 'ActionTranslate',
    showErrorToast: false,
    rethrowError: true,
    onResponse: smoothUpdate
  })

  // It's called only in initialization.
  // It will change target/alter language, so fetchResult will be triggered. Be careful!
  const updateLanguagePair = useCallback(async () => {
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

  const initialize = useCallback(async () => {
    if (initialized) {
      logger.silly('[initialize] Already initialized.')
      return
    }
    if (!isLanguagesLoaded) {
      logger.silly('[initialize] Languages not loaded. Skip initialization.')
      return
    }
    if (action.selectedText === undefined) {
      logger.error('[initialize] No selected text.')
      return
    }
    logger.silly('[initialize] Start initialization.')

    await updateLanguagePair()
    logger.silly('[initialize] UpdateLanguagePair completed.')

    setInitialized(true)
  }, [initialized, isLanguagesLoaded, updateLanguagePair, action.selectedText])

  useEffect(() => {
    void initialize()
  }, [initialize])

  const fetchResult = useCallback(async () => {
    if (!action.selectedText || !initialized) return
    cancelTranslate()
    smoothReset('')
    setContent('')
    setCompletionError(null)
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
      translateLang = targetLanguage
    } else {
      translateLang = sourceLanguageCode === targetLanguage.langCode ? alterLanguage : targetLanguage
    }
    setActualTargetLanguage(translateLang)

    setIsPreparing(true)
    const translated = await runTranslate(action.selectedText, translateLang).catch((err: Error) => {
      setCompletionError(err.message)
      smoothReset('')
      return undefined
    })
    setIsPreparing(false)
    if (translated) scrollToBottom?.()
  }, [
    action,
    initialized,
    cancelTranslate,
    detectLanguage,
    getLanguage,
    alterLanguage,
    targetLanguage,
    runTranslate,
    scrollToBottom,
    smoothReset
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

      if (newLang.langCode !== targetLanguage.langCode && newLang.langCode !== alterLanguage.langCode) {
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
              disabled={isTranslating}
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
              disabled={isTranslating}
            />
          </SettingsMenuItem>
        )
      }
    ],
    [t, targetLanguage, alterLanguage, isTranslating, getLanguage, handleChangeLanguage]
  )

  const handlePause = () => {
    cancelTranslate()
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

            <LanguageSelect
              value={actualTargetLanguage.langCode}
              style={{ minWidth: 100, maxWidth: 160 }}
              listHeight={160}
              size="small"
              optionFilterProp="label"
              onChange={handleDirectTargetChange}
              disabled={isTranslating}
            />

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
          {isPreparing && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {!isPreparing && content && <ResultContent>{content}</ResultContent>}
        </Result>
        {(detectError || completionError) && <ErrorMsg>{detectError || completionError}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isTranslating} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
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
  width: 100%;
`

const ResultContent = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
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
