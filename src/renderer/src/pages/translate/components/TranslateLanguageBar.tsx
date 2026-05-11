import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { useLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import type {
  TranslateBidirectionalPair,
  TranslateLangCode,
  TranslateSourceLanguage
} from '@shared/data/preference/preferenceTypes'
import { ArrowLeftRight, ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
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

const TranslateLanguageBar: FC<Props> = ({
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
  const [sourceOpen, setSourceOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [isSourceScrolling, setIsSourceScrolling] = useState(false)
  const [isTargetScrolling, setIsTargetScrolling] = useState(false)
  const sourceScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (sourceScrollTimerRef.current) clearTimeout(sourceScrollTimerRef.current)
      if (targetScrollTimerRef.current) clearTimeout(targetScrollTimerRef.current)
    },
    []
  )

  const selectableLanguages = useMemo(
    () => languages?.filter((lang) => String(lang.langCode) !== UNKNOWN_LANG_CODE) ?? [],
    [languages]
  )

  const getLanguageLabel = useCallback(
    (langCode: TranslateLangCode) => {
      const lang = getLanguage(langCode)
      return getLabel(lang ?? langCode, false) ?? lang?.value ?? langCode
    },
    [getLabel, getLanguage]
  )

  const sourceDisplay = useMemo(() => {
    if (sourceLanguage === 'auto') {
      const base = t('translate.detected.language')
      return {
        emoji: detectedLanguage ? (getLanguage(detectedLanguage)?.emoji ?? UNKNOWN_EMOJI) : AUTO_EMOJI,
        label: detectedLanguage ? `${base} (${getLanguageLabel(detectedLanguage)})` : base
      }
    }
    const lang = getLanguage(sourceLanguage)
    return {
      emoji: lang?.emoji ?? UNKNOWN_EMOJI,
      label: getLabel(lang ?? sourceLanguage, false) ?? lang?.value ?? sourceLanguage
    }
  }, [detectedLanguage, getLabel, getLanguage, getLanguageLabel, sourceLanguage, t])

  const target = getLanguage(targetLanguage)
  const targetLabel = getLabel(target ?? targetLanguage, false) ?? target?.value ?? targetLanguage

  const handleSourceSelect = (value: TranslateSourceLanguage) => {
    onSourceChange(value)
    setSourceOpen(false)
    setTargetOpen(false)
  }

  const handleTargetSelect = (lang: TranslateLangCode) => {
    if (lang === UNKNOWN_LANG_CODE) return
    onTargetChange(lang)
    setTargetOpen(false)
    setSourceOpen(false)
  }

  const handleSourceScroll = () => {
    setIsSourceScrolling(true)
    if (sourceScrollTimerRef.current) clearTimeout(sourceScrollTimerRef.current)
    sourceScrollTimerRef.current = setTimeout(() => setIsSourceScrolling(false), 1000)
  }

  const handleTargetScroll = () => {
    setIsTargetScrolling(true)
    if (targetScrollTimerRef.current) clearTimeout(targetScrollTimerRef.current)
    targetScrollTimerRef.current = setTimeout(() => setIsTargetScrolling(false), 1000)
  }

  return (
    <div className="flex h-10 shrink-0 items-center px-2">
      <Popover
        open={sourceOpen && !isBidirectional}
        onOpenChange={(next) => {
          setSourceOpen(next)
          if (next) setTargetOpen(false)
        }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isBidirectional}
            aria-haspopup="listbox"
            aria-expanded={sourceOpen && !isBidirectional}
            className={cn(
              triggerButtonClassName,
              'flex-1 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'
            )}>
            <span className="mr-0.5 text-[10px] text-foreground-muted">{t('translate.source_language')}</span>
            <span className="text-sm leading-none">{sourceDisplay.emoji}</span>
            <span className="max-w-[180px] truncate">{sourceDisplay.label}</span>
            <ChevronDown
              size={11}
              className={cn('text-foreground-muted transition-transform', sourceOpen && 'rotate-180')}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-1 shadow-xl">
          <div
            role="listbox"
            onScroll={handleSourceScroll}
            style={{
              scrollbarColor: isSourceScrolling ? 'var(--color-scrollbar-thumb) transparent' : 'transparent transparent'
            }}
            className="max-h-[240px] overflow-y-auto">
            <LanguageOption
              emoji={AUTO_EMOJI}
              label={
                detectedLanguage
                  ? `${t('translate.detected.language')} (${getLanguageLabel(detectedLanguage)})`
                  : t('translate.detected.language')
              }
              selected={sourceLanguage === 'auto'}
              onSelect={() => handleSourceSelect('auto')}
            />
            {selectableLanguages.map((lang) => (
              <LanguageOption
                key={lang.langCode}
                emoji={lang.emoji}
                label={getLabel(lang, false) ?? lang.value}
                selected={sourceLanguage !== 'auto' && sourceLanguage === lang.langCode}
                onSelect={() => handleSourceSelect(lang.langCode)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Tooltip content={t('translate.exchange.label')} placement="bottom">
        <Button
          variant="ghost"
          size="icon"
          onClick={onExchange}
          disabled={!couldExchange}
          aria-label={t('translate.exchange.label')}
          className="mx-1 h-8 w-8 shrink-0 rounded-full text-foreground-muted shadow-none transition-all hover:bg-accent hover:text-foreground active:scale-90">
          <ArrowLeftRight size={14} />
        </Button>
      </Tooltip>

      <div className="flex-1">
        {isBidirectional ? (
          <div className="flex h-full items-center justify-center rounded-md text-center text-muted-foreground text-xs">
            {`${getLanguageLabel(bidirectionalPair[0])} ⇆ ${getLanguageLabel(bidirectionalPair[1])}`}
          </div>
        ) : (
          <Popover
            open={targetOpen}
            onOpenChange={(next) => {
              setTargetOpen(next)
              if (next) setSourceOpen(false)
            }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={targetOpen}
                className={triggerButtonClassName}>
                <span className="mr-0.5 text-[10px] text-foreground-muted">{t('translate.target_language')}</span>
                <span className="text-sm leading-none">{target?.emoji ?? UNKNOWN_EMOJI}</span>
                <span className="max-w-[180px] truncate">{targetLabel}</span>
                <ChevronDown
                  size={11}
                  className={cn('text-foreground-muted transition-transform', targetOpen && 'rotate-180')}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-1 shadow-xl">
              <div
                role="listbox"
                onScroll={handleTargetScroll}
                style={{
                  scrollbarColor: isTargetScrolling
                    ? 'var(--color-scrollbar-thumb) transparent'
                    : 'transparent transparent'
                }}
                className="max-h-[240px] overflow-y-auto">
                {selectableLanguages.map((lang) => (
                  <LanguageOption
                    key={lang.langCode}
                    emoji={lang.emoji}
                    label={getLabel(lang, false) ?? lang.value}
                    selected={targetLanguage === lang.langCode}
                    onSelect={() => handleTargetSelect(lang.langCode)}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}

const triggerButtonClassName =
  'flex h-full w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-foreground text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const LanguageOption: FC<{
  emoji: string
  label: string
  selected: boolean
  onSelect: () => void
}> = ({ emoji, label, selected, onSelect }) => (
  <button
    type="button"
    role="option"
    aria-selected={selected}
    onClick={onSelect}
    className={cn(
      'w-full text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
    )}>
    <span
      className={cn(
        'flex items-center gap-2 py-[6px]',
        selected ? 'mx-1 my-0.5 rounded-md bg-accent px-2' : 'px-3 hover:bg-accent'
      )}>
      <span className="inline-flex w-5 shrink-0 justify-center text-sm leading-none">{emoji}</span>
      <span className="truncate">{label}</span>
    </span>
  </button>
)

export default TranslateLanguageBar
