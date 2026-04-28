import { Combobox, type ComboboxOption, Flex, InfoTooltip } from '@cherrystudio/ui'
import { TESSERACT_LANG_MAP } from '@renderer/config/ocr'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import type { TesseractLangCode } from '@renderer/types'
import { BuiltinOcrProviderIds, isOcrTesseractProvider } from '@renderer/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrTesseractSettings = () => {
  const { t } = useTranslation()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.tesseract)

  if (!isOcrTesseractProvider(provider)) {
    throw new Error('Not tesseract provider.')
  }

  const [langs, setLangs] = useState<Partial<Record<TesseractLangCode, boolean>>>(provider.config?.langs ?? {})
  const { translateLanguages } = useTranslate()

  const options = useMemo(
    () =>
      translateLanguages
        .map((lang) => ({
          value: TESSERACT_LANG_MAP[lang.langCode],
          label: lang.emoji + ' ' + lang.label()
        }))
        .filter((option) => option.value),
    [translateLanguages]
  )

  // TODO: type safe objectKeys
  const value = useMemo(
    () =>
      Object.entries(langs)
        .filter(([, enabled]) => enabled)
        .map(([lang]) => lang) as TesseractLangCode[],
    [langs]
  )

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

  const onChange = useCallback(
    (selectedValue: string | string[]) => {
      const values = (Array.isArray(selectedValue) ? selectedValue : []) as TesseractLangCode[]
      const nextLangs = values.reduce<Partial<Record<TesseractLangCode, boolean>>>((acc, lang) => {
        acc[lang] = true
        return acc
      }, {})

      setLangs(nextLangs)
      updateConfig({ langs: nextLangs })
    },
    [updateConfig]
  )

  return (
    <>
      <SettingRow>
        <SettingRowTitle>
          <Flex className="items-center gap-1">
            {t('settings.tool.ocr.common.langs')}
            <InfoTooltip content={t('settings.tool.ocr.tesseract.langs_tooltip')} />
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Combobox
            multiple
            width={220}
            value={value}
            options={options}
            onChange={onChange}
            renderValue={renderSelectedLanguages}
            searchable={false}
            placeholder={t('common.select')}
            emptyText={t('common.no_results')}
          />
        </div>
      </SettingRow>
    </>
  )
}
