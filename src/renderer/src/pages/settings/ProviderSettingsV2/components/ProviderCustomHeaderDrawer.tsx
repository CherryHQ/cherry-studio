import { Button, CodeEditor } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProviders'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { applyProviderCustomHeaderSideEffects } from '../adapters/providerSettingsSideEffects'
import ProviderSettingsDrawer from './ProviderSettingsDrawer'
import { ProviderHelpText } from './ProviderSettingsPrimitives'

interface ProviderCustomHeaderDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

export default function ProviderCustomHeaderDrawer({ providerId, open, onClose }: ProviderCustomHeaderDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { defaultHeaders, updateDefaultHeaders } = useCopilot()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()

  const headers = useMemo(
    () =>
      providerId === 'copilot'
        ? JSON.stringify(defaultHeaders || {}, null, 2)
        : JSON.stringify(provider?.settings?.extraHeaders || {}, null, 2),
    [defaultHeaders, provider?.settings?.extraHeaders, providerId]
  )

  const [headerText, setHeaderText] = useState(headers)

  useEffect(() => {
    if (open) {
      setHeaderText(headers)
    }
  }, [headers, open])

  const handleSave = useCallback(async () => {
    try {
      const parsedHeaders = headerText.trim() ? JSON.parse(headerText) : {}

      applyProviderCustomHeaderSideEffects({
        providerId,
        headers: parsedHeaders,
        updateCopilotHeaders: updateDefaultHeaders
      })

      await updateProvider({ providerSettings: { ...provider?.settings, extraHeaders: parsedHeaders } })

      window.toast.success(t('message.save.success.title'))
      onClose()
    } catch {
      window.toast.error(t('settings.provider.copilot.invalid_json'))
    }
  }, [headerText, onClose, provider?.settings, providerId, t, updateDefaultHeaders, updateProvider])

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button onClick={() => void handleSave()}>{t('common.save')}</Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.copilot.custom_headers')}
      footer={footer}
      size="form">
      <ProviderHelpText>{t('settings.provider.copilot.headers_description')}</ProviderHelpText>
      <CodeEditor
        theme={activeCmTheme}
        fontSize={fontSize - 1}
        value={headerText}
        language="json"
        onChange={(value) => setHeaderText(value)}
        placeholder={`{\n  "Header-Name": "Header-Value"\n}`}
        height="60vh"
        expanded={false}
        wrapped
        options={{
          lint: true,
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          keymap: true
        }}
      />
    </ProviderSettingsDrawer>
  )
}
