import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle, SettingSubtitle } from '../..'

type TesseractLanguagePacksProps = {
  options: ComboboxOption[]
  selectedLanguages: string[]
  onChange: (value: string | string[]) => void
}

export function TesseractLanguagePacks({ options, selectedLanguages, onChange }: TesseractLanguagePacksProps) {
  const { t } = useTranslation()
  const renderSelectedLanguages = useCallback(
    (selectedValue: string | string[], availableOptions: ComboboxOption[]) => {
      const selectedValues = Array.isArray(selectedValue) ? selectedValue : []
      if (selectedValues.length === 0) return <span className="text-muted-foreground">{t('common.select')}</span>

      const firstValue = selectedValues[0]
      const firstOption = availableOptions.find((option) => option.value === firstValue)

      return (
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate rounded bg-primary/10 px-2 py-0.5 text-primary text-xs">
            {firstOption?.label ?? firstValue}
          </span>
          {selectedValues.length > 1 && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
              +{selectedValues.length - 1}
            </span>
          )}
        </div>
      )
    },
    [t]
  )

  return (
    <>
      <SettingSubtitle>{t('settings.tool.file_processing.sections.language_packs')}</SettingSubtitle>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.file_processing.fields.languages')}</SettingRowTitle>
        <Combobox
          multiple
          width={220}
          value={selectedLanguages}
          options={options}
          onChange={onChange}
          renderValue={renderSelectedLanguages}
          searchable={false}
          placeholder={t('common.select')}
          emptyText={t('common.no_results')}
        />
      </SettingRow>
    </>
  )
}
