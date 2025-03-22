import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useKnowledge'
import { OcrProvider } from '@renderer/types'
import { Select } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import OcrProviderSettings from './OcrProviderSettings'

const KnowledgeSettings: FC = () => {
  const { ocrProviders } = useOcrProviders()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<OcrProvider>(ocrProviders[0])
  const { theme: themeMode } = useTheme()

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.knowledge.ocr.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.knowledge.ocr.provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProvider?.id}
              style={{ width: '200px' }}
              onChange={(value: string) => {
                const provider = ocrProviders.find((p) => p.id === value)
                if (!provider) return
                setSelectedProvider(provider)
              }}
              placeholder={t('settings.websearch.search_provider_placeholder')}
              options={ocrProviders.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={themeMode}>
        {selectedProvider && <OcrProviderSettings provider={selectedProvider} />}
      </SettingGroup>
    </SettingContainer>
  )
}
export default KnowledgeSettings
