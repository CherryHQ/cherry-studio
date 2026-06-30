import { Button, Combobox, type ComboboxOption, Tooltip } from '@cherrystudio/ui'
import { useLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils/style'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import type {
  TranslateBidirectionalPair,
  TranslateLangCode,
  TranslateSourceLanguage
} from '@shared/data/preference/preferenceTypes'
import { ArrowLeftRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  sourceLanguage: TranslateSourceLanguage
  onSourceChange: (language: TranslateSourceLanguage) => void
  targetLanguage: TranslateLangCode
  onTargetChange: (language: TranslateLangCode) => void
  detectedLanguage: TranslateLangCode | null
  isBidirectional: boolean
  bidirectionalPair: TranslateBidirectionalPair
  couldExchange: boolean
  onExchange: () => void
}

const AUTO_EMOJI = '🌐'
const UNKNOWN_EMOJI = '🏳️'
const LANGUAGE_SELECT_MIN_WIDTH = 150
const LANGUAGE_SELECT_MAX_WIDTH = 260
const LANGUAGE_SELECT_EXTRA_CH = 6

const getLanguageSelectWidth = (options: ComboboxOption[]) => {
  const maxLabelLength = Math.max(0, ...options.map((option) => Array.from(option.label).length))
  return `clamp(${LANGUAGE_SELECT_MIN_WIDTH}px, ${maxLabelLength + LANGUAGE_SELECT_EXTRA_CH}ch, ${LANGUAGE_SELECT_MAX_WIDTH}px)`
}

const TranslateLanguageBar: FC<Props> = ({
  className,
  sourceLanguage,
  onSourceChange,
  targetLanguage,
  onTargetChange,
  detectedLanguage,
  isBidirectional,
  bidirectionalPair,
  couldExchange,
  onExchange
}) => {
  const { t } = useTranslation()
  const { languages, getLabel, getLanguage } = useLanguages()

  const selectableLanguages = useMemo(
    () => languages?.filter((lang) => String(lang.langCode) !== UNKNOWN_LANG_CODE) ?? [],
    [languages]
  )

  const getLanguageDisplay = useCallback(
    (langCode: TranslateLangCode) => {
      const lang = getLanguage(langCode)
      return {
        emoji: lang?.emoji ?? UNKNOWN_EMOJI,
        label: getLabel(lang ?? langCode, false) ?? lang?.value ?? langCode
      }
    },
    [getLabel, getLanguage]
  )

  const sourceDisplay = useMemo(() => {
    if (sourceLanguage === 'auto') {
      const base = t('translate.detected.language')
      const detected = detectedLanguage === UNKNOWN_LANG_CODE ? null : detectedLanguage
      return {
        emoji: detected ? (getLanguage(detected)?.emoji ?? UNKNOWN_EMOJI) : AUTO_EMOJI,
        label: base
      }
    }
    const lang = getLanguage(sourceLanguage)
    return {
      emoji: lang?.emoji ?? UNKNOWN_EMOJI,
      label: getLabel(lang ?? sourceLanguage, false) ?? lang?.value ?? sourceLanguage
    }
  }, [detectedLanguage, getLabel, getLanguage, sourceLanguage, t])

  const autoSourceOption = useMemo(() => {
    const base = t('translate.detected.language')
    const detected = detectedLanguage === UNKNOWN_LANG_CODE ? null : detectedLanguage
    return {
      emoji: detected ? (getLanguage(detected)?.emoji ?? UNKNOWN_EMOJI) : AUTO_EMOJI,
      label: base
    }
  }, [detectedLanguage, getLanguage, t])

  const target = getLanguage(targetLanguage)
  const targetLabel = getLabel(target ?? targetLanguage, false) ?? target?.value ?? targetLanguage
  const bidirectionalSource = getLanguageDisplay(bidirectionalPair[0])
  const bidirectionalTarget = getLanguageDisplay(bidirectionalPair[1])

  const handleSourceSelect = (value: TranslateSourceLanguage) => {
    onSourceChange(value)
  }

  const handleTargetSelect = (lang: TranslateLangCode) => {
    if (lang === UNKNOWN_LANG_CODE) return
    onTargetChange(lang)
  }

  const languageIcon = useCallback((emoji: string) => <span className="text-sm leading-none">{emoji}</span>, [])

  const sourceOptions = useMemo<ComboboxOption[]>(
    () => [
      {
        value: 'auto',
        label: autoSourceOption.label,
        icon: languageIcon(autoSourceOption.emoji)
      },
      ...selectableLanguages.map((lang) => ({
        value: lang.langCode,
        label: getLabel(lang, false) ?? lang.value,
        icon: languageIcon(lang.emoji)
      }))
    ],
    [autoSourceOption.emoji, autoSourceOption.label, getLabel, languageIcon, selectableLanguages]
  )

  const targetOptions = useMemo<ComboboxOption[]>(
    () =>
      selectableLanguages.map((lang) => ({
        value: lang.langCode,
        label: getLabel(lang, false) ?? lang.value,
        icon: languageIcon(lang.emoji)
      })),
    [getLabel, languageIcon, selectableLanguages]
  )
  const sourceSelectWidth = useMemo(() => getLanguageSelectWidth(sourceOptions), [sourceOptions])
  const targetSelectWidth = useMemo(() => getLanguageSelectWidth(targetOptions), [targetOptions])

  return (
    <div className={cn('flex shrink-0 items-center gap-3 px-4 py-4 lg:px-6', className)}>
      {!isBidirectional && (
        <>
          <Combobox
            size="default"
            options={sourceOptions}
            value={sourceLanguage}
            onChange={(value) => handleSourceSelect(Array.isArray(value) ? value[0] : value)}
            placeholder={t('translate.source_language')}
            searchable={false}
            emptyText={t('common.no_results')}
            width={sourceSelectWidth}
            popoverClassName="w-(--radix-popover-trigger-width)"
            renderValue={(value, options) => {
              const option = options.find((item) => item.value === value)
              return (
                <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
                  <span className="sr-only">{t('translate.source_language')}</span>
                  {option?.icon}
                  <span className="truncate">{option?.label ?? sourceDisplay.label}</span>
                </div>
              )
            }}
          />

          <Tooltip content={t('translate.exchange.label')} placement="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={onExchange}
              disabled={!couldExchange}
              aria-label={t('translate.exchange.label')}
              className="h-8 w-8 shrink-0 rounded-full text-foreground-muted shadow-none transition-all hover:bg-accent hover:text-foreground active:scale-90">
              <ArrowLeftRight size={14} />
            </Button>
          </Tooltip>
        </>
      )}

      {isBidirectional ? (
        <Button
          variant="outline"
          size="default"
          type="button"
          disabled
          aria-label={`${bidirectionalSource.label} ⇆ ${bidirectionalTarget.label}`}
          className="h-8 max-w-70 justify-start gap-2 bg-zinc-50 px-3 text-foreground text-sm shadow-none disabled:opacity-100 dark:bg-zinc-900">
          <span className="sr-only">{`${bidirectionalSource.label} ⇆ ${bidirectionalTarget.label}`}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-sm leading-none">{bidirectionalSource.emoji}</span>
            <span className="truncate">{bidirectionalSource.label}</span>
          </span>
          <ArrowLeftRight size={14} className="shrink-0 text-foreground-muted" />
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-sm leading-none">{bidirectionalTarget.emoji}</span>
            <span className="truncate">{bidirectionalTarget.label}</span>
          </span>
        </Button>
      ) : (
        <Combobox
          size="default"
          options={targetOptions}
          value={targetLanguage}
          onChange={(value) => handleTargetSelect(Array.isArray(value) ? value[0] : value)}
          placeholder={t('translate.target_language')}
          searchable={false}
          emptyText={t('common.no_results')}
          width={targetSelectWidth}
          popoverClassName="w-(--radix-popover-trigger-width)"
          renderValue={(value, options) => {
            const option = options.find((item) => item.value === value)
            return (
              <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
                <span className="sr-only">{t('translate.target_language')}</span>
                {option?.icon ?? languageIcon(target?.emoji ?? UNKNOWN_EMOJI)}
                <span className="truncate">{option?.label ?? targetLabel}</span>
              </div>
            )
          }}
        />
      )}
    </div>
  )
}

export default TranslateLanguageBar
