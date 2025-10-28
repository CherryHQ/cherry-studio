// import { loggerService } from '@logger'
import { Flex } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'
import CustomTag from '@renderer/components/Tags/CustomTag'
import useTranslate from '@renderer/hooks/useTranslate'
import type { OcrProviderConfig, OcrTesseractConfig, OcrTesseractProvider, TesseractLangCode } from '@renderer/types'
import { objectEntries } from '@renderer/types'
import { TESSERACT_LANG_MAP } from '@shared/config/ocr'
import { Select } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrTesseractSettings')

export const OcrTesseractSettings = ({
  provider,
  updateConfig: _updateConfig
}: {
  provider: OcrTesseractProvider
  updateConfig: (config: Partial<OcrProviderConfig>) => Promise<void>
}) => {
  const updateConfig = _updateConfig as (config: Partial<OcrTesseractConfig>) => Promise<void>

  const { t } = useTranslation()

  const [langs, setLangs] = useState<OcrTesseractConfig['langs'] | undefined>(provider?.config.langs)
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

  const selectedLangs = useMemo(() => {
    if (!langs) return
    return objectEntries(langs)
      .filter(([, enabled]) => enabled)
      .map(([lang]) => lang) as TesseractLangCode[]
  }, [langs])

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
          <Flex className="items-center gap-1">
            {t('settings.tool.ocr.common.langs')}
            <InfoTooltip content={t('settings.tool.ocr.tesseract.langs_tooltip')} />
          </Flex>
        </SettingRowTitle>
        <div className="flex gap-2">
          <Select
            mode="multiple"
            style={{ minWidth: 200 }}
            value={selectedLangs}
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
