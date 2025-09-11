// import { loggerService } from '@logger'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { TESSERACT_LANG_MAP } from '@renderer/config/ocr'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { BuiltinOcrProviderIds, isOcrTesseractProvider, TesseractLangCode } from '@renderer/types'
import { Flex, Select } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrTesseractSettings')

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

  const onChange = useCallback((values: TesseractLangCode[]) => {
    setLangs(() => {
      const newLangs = {}
      values.forEach((v) => {
        newLangs[v] = true
      })
      return newLangs
    })
  }, [])

  const onBlur = useCallback(() => {
    updateConfig({ langs })
  }, [langs, updateConfig])

  return (
    <>
      <SettingRow>
        <SettingRowTitle>
          <Flex align="center" gap={4}>
            {t('settings.tool.ocr.common.langs')}
            <InfoTooltip title={t('settings.tool.ocr.tesseract.langs_tooltip')} />
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Select
            mode="multiple"
            style={{ minWidth: 200 }}
            value={value}
            options={options}
            maxTagCount={1}
            onChange={onChange}
            onBlur={onBlur}
            // use tag render to disable default close action
            // don't modify this, because close action won't trigger onBlur to update state
            tagRender={(props) => <CustomTag color="var(--color-text)">{props.label}</CustomTag>}
          />
        </div>
      </SettingRow>
    </>
  )
}
