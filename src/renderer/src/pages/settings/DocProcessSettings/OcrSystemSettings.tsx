// import { loggerService } from '@logger'
import { Flex } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'
import { SuccessTag } from '@renderer/components/Tags/SuccessTag'
import { isMac, isWin } from '@renderer/config/constant'
import { useLanguages } from '@renderer/hooks/translate/useLanguages'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrSystemProvider } from '@renderer/types'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { Select } from 'antd'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrSystemSettings')

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
        label: getLabel(lang)
      })) ?? [],
    [getLabel, languages]
  )

  const onChange = useCallback((value: TranslateLangCode[]) => {
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
          <Flex className="items-center gap-1">
            {t('settings.tool.ocr.common.langs')}
            {isWin && <InfoTooltip content={t('settings.tool.ocr.system.win.langs_tooltip')} />}
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isMac && <SuccessTag message={t('settings.tool.ocr.image.system.no_need_configure')} />}
          {isWin && (
            <Select
              mode="multiple"
              style={{ width: '100%', minWidth: 200 }}
              value={langs}
              options={options}
              onChange={onChange}
              onBlur={onBlur}
              maxTagCount={1}
            />
          )}
        </div>
      </SettingRow>
    </>
  )
}
