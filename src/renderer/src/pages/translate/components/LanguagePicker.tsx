import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useLanguages } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { Check, ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  value: TranslateLangCode
  onChange: (value: TranslateLangCode) => void
  disabled?: boolean
  className?: string
}

const UNKNOWN_EMOJI = '🏳️'

const LanguagePicker: FC<Props> = ({ value, onChange, disabled, className }) => {
  const { languages, getLabel, getLanguage } = useLanguages()
  const [open, setOpen] = useState(false)
  const [isScrolling, setIsScrolling] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const options = useMemo(
    () => languages?.filter((lang) => String(lang.langCode) !== UNKNOWN_LANG_CODE) ?? [],
    [languages]
  )

  const selected = getLanguage(value)
  const selectedLabel = selected ? (getLabel(selected, false) ?? selected.value) : (getLabel(null, false) ?? value)

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border/40 bg-transparent px-2.5 text-sm transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60',
            open && 'border-primary/40 ring-1 ring-primary/15',
            className
          )}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-sm leading-none">{selected?.emoji ?? UNKNOWN_EMOJI}</span>
            <span className="truncate text-foreground">{selectedLabel}</span>
          </span>
          <ChevronDown
            size={11}
            className={cn('shrink-0 text-foreground-muted transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-1 shadow-xl">
        <div
          role="listbox"
          onScroll={handleScroll}
          style={{
            scrollbarColor: isScrolling ? 'var(--color-scrollbar-thumb) transparent' : 'transparent transparent'
          }}
          className="max-h-[240px] overflow-y-auto">
          {options.map((lang) => {
            const isSelected = lang.langCode === value
            const label = getLabel(lang, false) ?? lang.value
            return (
              <button
                key={lang.langCode}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(lang.langCode)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}>
                <span className="inline-flex w-5 shrink-0 justify-center text-sm leading-none">{lang.emoji}</span>
                <span className="flex-1 truncate">{label}</span>
                {isSelected && <Check size={11} className="shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default LanguagePicker
