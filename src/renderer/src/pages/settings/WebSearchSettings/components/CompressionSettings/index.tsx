import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../../..'
import CutoffSettings from './CutoffSettings'

const INPUT_BOX_WIDTH_CUTOFF = '200px'

const CompressionSettings = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCompressionMethodChange = (value: 'none' | 'cutoff') => {
    void updateCompressionConfig({
      method: value,
      cutoffLimit: value === 'cutoff' ? compressionConfig?.cutoffLimit || DEFAULT_WEB_SEARCH_CUTOFF_LIMIT : undefined
    })
  }

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') }
  ]

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow className="gap-8 py-2">
        <SettingRowTitle className="shrink-0">{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select value={compressionConfig?.method || 'none'} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger style={{ width: INPUT_BOX_WIDTH_CUTOFF }}>
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
    </SettingGroup>
  )
}

export default CompressionSettings
