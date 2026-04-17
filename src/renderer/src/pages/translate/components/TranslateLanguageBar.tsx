import { Button, Tooltip } from '@cherrystudio/ui'
import { UNKNOWN } from '@renderer/config/translate'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import type { TranslateLanguage } from '@renderer/types'
import { ArrowLeftRight, ChevronDown } from 'lucide-react'
import type { FC, ReactNode, RefObject } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// TODO(v2/pr-14315): Replace the custom LanguageDropdown / LanguageOption with
// `<SelectDropdown>` from `@cherrystudio/ui` once this page consumes that
// composite.

type Props = {
  sourceLanguage: TranslateLanguage | 'auto'
  onSourceChange: (language: TranslateLanguage | 'auto') => void
  targetLanguage: TranslateLanguage
  onTargetChange: (language: TranslateLanguage) => void
  detectedLanguage: TranslateLanguage | null
  isBidirectional: boolean
  bidirectionalPair: [TranslateLanguage, TranslateLanguage]
  couldExchange: boolean
  onExchange: () => void
}

const AUTO_EMOJI = '🌐'

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
  const { translateLanguages } = useTranslate()
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
    () => translateLanguages.filter((l) => l.langCode !== UNKNOWN.langCode),
    [translateLanguages]
  )

  const sourceDisplay = useMemo(() => {
    if (sourceLanguage === 'auto') {
      const base = t('translate.detected.language')
      return {
        emoji: detectedLanguage?.emoji ?? AUTO_EMOJI,
        label: detectedLanguage ? `${base} (${detectedLanguage.label()})` : base
      }
    }
    return { emoji: sourceLanguage.emoji, label: sourceLanguage.label() }
  }, [detectedLanguage, sourceLanguage, t])

  const handleSourceSelect = (value: TranslateLanguage | 'auto') => {
    onSourceChange(value)
    void db.settings.put({ id: 'translate:source:language', value: value === 'auto' ? 'auto' : value.langCode })
    setSourceOpen(false)
  }

  const handleTargetSelect = (lang: TranslateLanguage) => {
    if (lang.langCode === UNKNOWN.langCode) return
    onTargetChange(lang)
    void db.settings.put({ id: 'translate:target:language', value: lang.langCode })
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
          className="flex h-full w-full items-center justify-center gap-1.5 rounded-2xs py-1.5 text-foreground text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent">
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
                  ? `${t('translate.detected.language')} (${detectedLanguage.label()})`
                  : t('translate.detected.language')
              }
              selected={sourceLanguage === 'auto'}
              onSelect={() => handleSourceSelect('auto')}
            />
            {selectableLanguages.map((lang) => (
              <LanguageOption
                key={lang.langCode}
                emoji={lang.emoji}
                label={lang.label()}
                selected={sourceLanguage !== 'auto' && sourceLanguage.langCode === lang.langCode}
                onSelect={() => handleSourceSelect(lang)}
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
          <div className="flex h-full items-center justify-center rounded-3xs text-center text-muted-foreground text-xs">
            {`${bidirectionalPair[0].label()} ⇆ ${bidirectionalPair[1].label()}`}
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
              className="flex h-full w-full items-center justify-center gap-1.5 rounded-2xs py-1.5 text-foreground text-xs transition-colors hover:bg-accent">
              <span className="mr-0.5 text-[10px] text-foreground-muted">{t('translate.target_language')}</span>
              <span className="text-sm leading-none">{targetLanguage.emoji}</span>
              <span className="max-w-[180px] truncate">{targetLanguage.label()}</span>
              <ChevronDown size={11} className="text-foreground-muted" />
            </button>
            {targetOpen && (
              <LanguageDropdown anchorX={targetAnchorX} containerRef={targetRef}>
                {selectableLanguages.map((lang) => (
                  <LanguageOption
                    key={lang.langCode}
                    emoji={lang.emoji}
                    label={lang.label()}
                    selected={targetLanguage.langCode === lang.langCode}
                    onSelect={() => handleTargetSelect(lang)}
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

const LanguageDropdown: FC<{
  anchorX: number
  containerRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}> = ({ anchorX, containerRef, children }) => {
  const containerWidth = containerRef.current?.clientWidth ?? 0
  const half = DROPDOWN_WIDTH / 2
  const maxLeft = Math.max(0, containerWidth - DROPDOWN_WIDTH)
  const left = Math.min(Math.max(anchorX - half, 0), maxLeft)
  // `left` is a runtime-computed pixel anchored to the click position; a
  // Tailwind class can't express a dynamic value per-instance.
  return (
    <div
      style={{ left }}
      className="absolute top-full z-50 mt-1 max-h-[240px] w-40 overflow-y-auto rounded-xs border border-border bg-popover py-1 shadow-xl">
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
    onClick={onSelect}
    className={`w-full text-left text-xs transition-colors ${
      selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`}>
    <span
      className={`flex items-center gap-2 px-3 py-[6px] ${
        selected ? 'mx-1 my-0.5 rounded-2xs bg-accent px-2' : 'hover:bg-accent'
      }`}>
      <span className="inline-flex w-5 shrink-0 justify-center text-sm leading-none">{emoji}</span>
      <span className="truncate">{label}</span>
    </span>
  </button>
)

export default TranslateLanguageBar
