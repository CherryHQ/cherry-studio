import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'
import RagSettings from './RagSettings'

const INPUT_BOX_WIDTH_CUTOFF = '200px'
const INPUT_BOX_WIDTH_RAG = 'min(350px, 60%)'

const CompressionSettings = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') },
    { value: 'rag', label: t('settings.tool.websearch.compression.method.rag') }
  ]

  const handleCompressionMethodChange = (method: 'none' | 'cutoff' | 'rag') => {
    updateCompressionConfig({ method })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow className="-py-2 gap-8">
        <SettingRowTitle className="shrink-0">{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select
          value={compressionConfig?.method || 'none'}
          onValueChange={(value) => handleCompressionMethodChange(value as 'none' | 'cutoff' | 'rag')}>
          <SelectTrigger
            style={{ width: compressionConfig?.method === 'rag' ? INPUT_BOX_WIDTH_RAG : INPUT_BOX_WIDTH_CUTOFF }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {compressionMethodOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      {compressionConfig?.method === 'cutoff' && <CutoffSettings />}
      {compressionConfig?.method === 'rag' && <RagSettings />}
    </SettingGroup>
  )
}

export default CompressionSettings
