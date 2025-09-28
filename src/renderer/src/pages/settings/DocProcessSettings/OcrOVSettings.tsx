import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { BuiltinOcrProviderIds, isOcrOVProvider, TranslateLanguageCode } from '@renderer/types'
import { Flex, Select } from 'antd'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrOVSettings = () => {
  const { t } = useTranslation()
  const { translateLanguages } = useTranslate()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.ovocr)

  if (!isOcrOVProvider(provider)) {
    throw new Error('Not OV OCR provider.')
  }

  const [langs, setLangs] = useState<TranslateLanguageCode[]>(provider.config?.langs ?? [])

  const options = useMemo(
    () =>
      translateLanguages.map((lang) => ({
        value: lang.langCode,
        label: lang.emoji + ' ' + lang.label()
      })),
    [translateLanguages]
  )

  const onChange = useCallback((value: TranslateLanguageCode[]) => {
    startTransition(() => {
      setLangs(value)
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
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Select
            mode="multiple"
            style={{ width: '100%', minWidth: 200 }}
            value={langs}
            options={options}
            onChange={onChange}
            onBlur={onBlur}
            maxTagCount={1}
          />
        </div>
      </SettingRow>
    </>
  )
}
