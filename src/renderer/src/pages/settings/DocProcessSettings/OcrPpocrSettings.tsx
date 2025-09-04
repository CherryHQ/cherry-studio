import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrPpocrProvider } from '@renderer/types'
import { Input } from 'antd'
import { startTransition, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrPpocrSettings = () => {
  const { t } = useTranslation()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.paddleocr)

  if (!isOcrPpocrProvider(provider)) {
    throw new Error('Not PaddleOCR provider.')
  }

  const [apiUrl, setApiUrl] = useState<string>(provider.config.apiUrl || '')
  const [aistudioAccessToken, setAistudioAccessToken] = useState<string>(provider.config.aistudioAccessToken || '')

  const onApiUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    startTransition(() => {
      setApiUrl(value)
    })
  }, [])
  const onAistudioAccessTokenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    startTransition(() => {
      setAistudioAccessToken(value)
    })
  }, [])

  const onBlur = useCallback(() => {
    updateConfig({
      apiUrl,
      aistudioAccessToken
    })
  }, [apiUrl, aistudioAccessToken, updateConfig])

  return (
    <>
      <SettingRow>
        <SettingRowTitle style={{ width: 150 }}>{t('settings.tool.ocr.paddleocr.api_url')}</SettingRowTitle>
        <Input
          value={apiUrl}
          onChange={onApiUrlChange}
          onBlur={onBlur}
          placeholder={t('settings.tool.ocr.paddleocr.api_url')}
        />
      </SettingRow>

      <SettingRow>
        <SettingRowTitle style={{ width: 150 }}>
          {t('settings.tool.ocr.paddleocr.aistudio_access_token')}
        </SettingRowTitle>
        <Input.Password
          value={aistudioAccessToken}
          onChange={onAistudioAccessTokenChange}
          onBlur={onBlur}
          placeholder={t('settings.tool.ocr.paddleocr.aistudio_access_token')}
          spellCheck={false}
        />
      </SettingRow>
    </>
  )
}
