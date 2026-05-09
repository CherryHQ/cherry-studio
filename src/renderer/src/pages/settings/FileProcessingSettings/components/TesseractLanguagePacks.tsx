import {
  Button,
  type ComboboxOption,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { Check, Plus, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsSection } from './SettingsSection'

type TesseractLanguagePacksProps = {
  options: ComboboxOption[]
  selectedLanguages: string[]
  onChange: (langs: string[]) => void
}

export function TesseractLanguagePacks({ options, selectedLanguages, onChange }: TesseractLanguagePacksProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const optionByValue = useMemo(() => {
    return new Map(options.map((option) => [option.value, option]))
  }, [options])

  const selectedItems = useMemo(() => {
    return selectedLanguages.map((value) => ({
      value,
      label: optionByValue.get(value)?.label ?? value
    }))
  }, [optionByValue, selectedLanguages])

  const toggleLanguage = useCallback(
    (value: string) => {
      const nextLanguages = selectedLanguages.includes(value)
        ? selectedLanguages.filter((lang) => lang !== value)
        : [...selectedLanguages, value]

      onChange(nextLanguages)
      setOpen(false)
    },
    [onChange, selectedLanguages]
  )

  const removeLanguage = useCallback(
    (value: string) => {
      onChange(selectedLanguages.filter((lang) => lang !== value))
    },
    [onChange, selectedLanguages]
  )

  return (
    <SettingsSection title={t('settings.tool.file_processing.sections.language_packs')} className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {selectedItems.map((item) => (
          <div
            key={item.value}
            className="flex min-w-0 items-center gap-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-2.5 py-[4px]">
            <span className="max-w-[160px] truncate font-medium text-emerald-600 text-xs leading-tight dark:text-emerald-400">
              {item.label}
            </span>
            <span className="shrink-0 text-emerald-500/50 text-xs leading-tight">({item.value})</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-auto w-auto shrink-0 p-0 text-emerald-500/30 shadow-none hover:bg-transparent hover:text-emerald-500/60"
              aria-label={t('settings.tool.file_processing.processors.tesseract.actions.remove_language', {
                language: item.label
              })}
              onClick={() => removeLanguage(item.value)}>
              <X size={9} />
            </Button>
          </div>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-lg border-foreground/15 border-dashed px-2.5 py-[4px] text-foreground/35 text-xs leading-tight shadow-none hover:border-foreground/25 hover:bg-transparent hover:text-foreground/55">
              <Plus size={9} />
              <span>{t('settings.tool.file_processing.processors.tesseract.actions.add_language')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-1">
            <Command>
              <CommandList>
                <CommandEmpty>{t('common.no_results')}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => {
                    const selected = selectedLanguages.includes(option.value)

                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        onSelect={() => toggleLanguage(option.value)}
                        className="gap-2 rounded-md px-2 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        <span className="shrink-0 text-muted-foreground text-xs leading-tight">({option.value})</span>
                        {selected ? <Check size={12} className="shrink-0 text-emerald-500" /> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </SettingsSection>
  )
}
