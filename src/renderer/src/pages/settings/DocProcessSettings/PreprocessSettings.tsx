import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultPreprocessProvider, usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { PreprocessProvider } from '@renderer/types'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import PreprocessProviderSettings from './PreprocessProviderSettings'

const PreprocessSettings: FC = () => {
  const { preprocessProviders } = usePreprocessProviders()
  const { provider: defaultProvider, setDefaultPreprocessProvider } = useDefaultPreprocessProvider()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<PreprocessProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  function updateSelectedPreprocessProvider(providerId: string) {
    const provider = preprocessProviders.find((p) => p.id === providerId)
    if (!provider) {
      return
    }
    setDefaultPreprocessProvider(provider)
    setSelectedProvider(provider)
  }

  return (
    <>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.preprocess.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.preprocess.provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProvider?.id}
              onValueChange={(value: string) => updateSelectedPreprocessProvider(value)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t('settings.tool.preprocess.provider_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {preprocessProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SettingRow>
      </SettingGroup>
      {selectedProvider && (
        <SettingGroup theme={themeMode}>
          <PreprocessProviderSettings provider={selectedProvider} />
        </SettingGroup>
      )}
    </>
  )
}
export default PreprocessSettings
