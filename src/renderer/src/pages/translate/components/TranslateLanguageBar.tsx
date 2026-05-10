import { Button, Tooltip } from '@cherrystudio/ui'
import { useLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import type {
  TranslateBidirectionalPair,
  TranslateLangCode,
  TranslateSourceLanguage
} from '@shared/data/preference/preferenceTypes'
import { ArrowLeftRight, ChevronDown } from 'lucide-react'
import type { FC, ReactNode, RefObject } from 'react'
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
  const [sourceAnchorX, setSourceAnchorX] = useState(0)
  const [targetAnchorX, setTargetAnchorX] = useState(0)
  const sourceRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sourceOpen && !targetOpen) return
    const handler = (e: MouseEvent) => {
      if (sourceOpen && sourceRef.current && !sourceRef.current.contains(e.target as Node)) {
        setSourceOpen(false)
      }
      if (targetOpen && targetRef.current && !targetRef.current.contains(e.target as Node)) {
        setTargetOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sourceOpen, targetOpen])

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
  }

  const handleTargetSelect = (lang: TranslateLangCode) => {
    if (lang === UNKNOWN_LANG_CODE) return
    onTargetChange(lang)
    setTargetOpen(false)
  }

  return (
    <div className="flex h-10 shrink-0 items-center px-2">
      <div ref={sourceRef} className="relative flex-1">
        <button
          type="button"
          disabled={isBidirectional}
          onClick={(e) => {
            if (sourceRef.current) {
              const rect = sourceRef.current.getBoundingClientRect()
              setSourceAnchorX(e.clientX - rect.left)
            }
            setSourceOpen((v) => !v)
            setTargetOpen(false)
          }}
          className={cn(
            triggerButtonClassName,
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'
          )}>
          <span className="mr-0.5 text-[10px] text-foreground-muted">{t('translate.source_language')}</span>
          <span className="text-sm leading-none">{sourceDisplay.emoji}</span>
          <span className="max-w-[180px] truncate">{sourceDisplay.label}</span>
          <ChevronDown size={11} className="text-foreground-muted" />
        </button>
        {sourceOpen && (
          <LanguageDropdown anchorX={sourceAnchorX} containerRef={sourceRef}>
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
          </LanguageDropdown>
        )}
      </div>

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

      <div ref={targetRef} className="relative flex-1">
        {isBidirectional ? (
          <div className="flex h-full items-center justify-center rounded-md text-center text-muted-foreground text-xs">
            {`${getLanguageLabel(bidirectionalPair[0])} ⇆ ${getLanguageLabel(bidirectionalPair[1])}`}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => {
                if (targetRef.current) {
                  const rect = targetRef.current.getBoundingClientRect()
                  setTargetAnchorX(e.clientX - rect.left)
                }
                setTargetOpen((v) => !v)
                setSourceOpen(false)
              }}
              className={triggerButtonClassName}>
              <span className="mr-0.5 text-[10px] text-foreground-muted">{t('translate.target_language')}</span>
              <span className="text-sm leading-none">{target?.emoji ?? UNKNOWN_EMOJI}</span>
              <span className="max-w-[180px] truncate">{targetLabel}</span>
              <ChevronDown size={11} className="text-foreground-muted" />
            </button>
            {targetOpen && (
              <LanguageDropdown anchorX={targetAnchorX} containerRef={targetRef}>
                {selectableLanguages.map((lang) => (
                  <LanguageOption
                    key={lang.langCode}
                    emoji={lang.emoji}
                    label={getLabel(lang, false) ?? lang.value}
                    selected={targetLanguage === lang.langCode}
                    onSelect={() => handleTargetSelect(lang.langCode)}
                  />
                ))}
              </LanguageDropdown>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const DROPDOWN_WIDTH = 160
const triggerButtonClassName =
  'flex h-full w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-foreground text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const LanguageDropdown: FC<{
  anchorX: number
  containerRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}> = ({ anchorX, containerRef, children }) => {
  const containerWidth = containerRef.current?.clientWidth ?? 0
  const half = DROPDOWN_WIDTH / 2
  const maxLeft = Math.max(0, containerWidth - DROPDOWN_WIDTH)
  const left = Math.min(Math.max(anchorX - half, 0), maxLeft)
  const [isScrolling, setIsScrolling] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleScroll = () => {
    setIsScrolling(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIsScrolling(false), 1000)
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return (
    <div
      role="listbox"
      onScroll={handleScroll}
      style={{
        left,
        scrollbarColor: isScrolling ? 'var(--color-scrollbar-thumb) transparent' : 'transparent transparent'
      }}
      className="absolute top-full z-50 mt-1 max-h-[240px] w-40 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-xl">
      {children}
    </div>
  )
}

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
