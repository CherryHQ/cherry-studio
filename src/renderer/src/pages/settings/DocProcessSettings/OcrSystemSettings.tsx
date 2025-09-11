// import { loggerService } from '@logger'
import { SuccessTag } from '@renderer/components/Tags/SuccessTag'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { isMac, isWin } from '@renderer/config/constant'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import useTranslate from '@renderer/hooks/useTranslate'
import { BuiltinOcrProviderIds, isOcrSystemProvider, TranslateLanguageCode } from '@renderer/types'
import { Flex, Select } from 'antd'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrSystemSettings')

export const OcrSystemSettings = () => {
  const { t } = useTranslation()
  // 和翻译自定义语言耦合了，应该还ok
  const { translateLanguages } = useTranslate()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.system)

  if (!isOcrSystemProvider(provider)) {
    throw new Error('Not system provider.')
  }

  if (!isWin && !isMac) {
    throw new Error('Only Windows and MacOS is supported.')
  }

  const [langs, setLangs] = useState<TranslateLanguageCode[]>(provider.config?.langs ?? [])

  // currently static
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
            {isWin && <InfoTooltip title={t('settings.tool.ocr.system.win.langs_tooltip')} />}
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
