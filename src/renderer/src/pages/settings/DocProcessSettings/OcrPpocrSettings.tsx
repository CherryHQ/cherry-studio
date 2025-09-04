import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrPpocrProvider } from '@renderer/types'
import { Input } from 'antd'
import { startTransition, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingRow, SettingRowTitle } from '..'

export const OcrPpocrSettings = () => {
  // Hack: Hard-coded for now
  const SERVING_DOC_URL = 'https://www.paddleocr.ai/latest/version3.x/deployment/serving.html'
  const AISTUDIO_URL = 'https://aistudio.baidu.com/pipeline/mine'

  const { t } = useTranslation()
  const { provider, updateConfig } = useOcrProvider(BuiltinOcrProviderIds.paddleocr)

  if (!isOcrPpocrProvider(provider)) {
    throw new Error('Not PaddleOCR provider.')
  }

  const [apiUrl, setApiUrl] = useState<string>(provider.config.apiUrl || '')
  const [accessToken, setAccessToken] = useState<string>(provider.config.accessToken || '')

  const onApiUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    startTransition(() => {
      setApiUrl(value)
    })
  }, [])
  const onAccessTokenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    startTransition(() => {
      setAccessToken(value)
    })
  }, [])

  const onBlur = useCallback(() => {
    updateConfig({
      apiUrl,
      accessToken
    })
  }, [apiUrl, accessToken, updateConfig])

  return (
    <ErrorBoundary>
      <SettingRow style={{ marginBottom: 10 }}>
        <SettingRowTitle style={{ width: 150 }}>{t('settings.tool.ocr.paddleocr.api_url')}</SettingRowTitle>
        <Input
          value={apiUrl}
          onChange={onApiUrlChange}
          onBlur={onBlur}
          placeholder={t('settings.tool.ocr.paddleocr.api_url')}
        />
      </SettingRow>

      <SettingRow style={{ marginBottom: 10 }}>
        <SettingRowTitle style={{ width: 150 }}>
          {t('settings.tool.ocr.paddleocr.aistudio_access_token')}
        </SettingRowTitle>
        <Input.Password
          value={accessToken}
          onChange={onAccessTokenChange}
          onBlur={onBlur}
          placeholder={t('settings.tool.ocr.paddleocr.aistudio_access_token')}
          spellCheck={false}
        />
      </SettingRow>

      <SettingHelpTextRow style={{ display: 'flex', flexDirection: 'column' }}>
        <SettingHelpText style={{ marginBottom: 5 }}>{t('settings.tool.ocr.paddleocr.tip')}</SettingHelpText>
        <div style={{ display: 'flex', gap: 12 }}>
          <SettingHelpLink target="_blank" href={SERVING_DOC_URL}>
            {t('settings.tool.ocr.paddleocr.serving_doc_url_label')}
          </SettingHelpLink>
          <SettingHelpLink target="_blank" href={AISTUDIO_URL}>
            {t('settings.tool.ocr.paddleocr.aistudio_url_label')}
          </SettingHelpLink>
        </div>
      </SettingHelpTextRow>
    </ErrorBoundary>
  )
}
