import { Combobox, type ComboboxOption, Flex, InfoTooltip } from '@cherrystudio/ui'
import { SuccessTag } from '@renderer/components/Tags/SuccessTag'
import { isMac, isWin } from '@renderer/config/constant'
import { useLanguages } from '@renderer/hooks/translate/useTranslateLanguages'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrSystemProvider } from '@renderer/types'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrSystemSettings = () => {
  const { t } = useTranslation()
  // 和翻译自定义语言耦合了，应该还ok
  const { languages, getLabel } = useLanguages()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.system)

  if (!isOcrSystemProvider(provider)) {
    throw new Error('Not system provider.')
  }

  if (!isWin && !isMac) {
    throw new Error('Only Windows and MacOS is supported.')
  }

  const [langs, setLangs] = useState<TranslateLangCode[]>(provider.config?.langs ?? [])

  // currently static
  const options = useMemo(
    () =>
      languages?.map((lang) => ({
        value: lang.langCode,
        label: getLabel(lang) ?? lang.langCode
      })) ?? [],
    [getLabel, languages]
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
    (value: string | string[]) => {
      const nextLangs = (Array.isArray(value) ? value : []).filter(isTranslateLangCode)
      startTransition(() => {
        setLangs(nextLangs)
      })
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
            {isWin && <InfoTooltip content={t('settings.tool.ocr.system.win.langs_tooltip')} />}
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isMac && <SuccessTag message={t('settings.tool.ocr.image.system.no_need_configure')} />}
          {isWin && (
            <Combobox
              multiple
              width={220}
              value={langs}
              options={options}
              onChange={onChange}
              renderValue={renderSelectedLanguages}
              searchable={false}
              placeholder={t('common.select')}
              emptyText={t('common.no_results')}
            />
          )}
        </div>
      </SettingRow>
    </>
  )
}
