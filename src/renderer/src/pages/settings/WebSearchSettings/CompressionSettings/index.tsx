import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'

const INPUT_BOX_WIDTH_CUTOFF = '200px'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') }
  ]

  const handleCompressionMethodChange = (method: 'none' | 'cutoff') => {
    void updateCompressionConfig({ method })
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select
          value={compressionConfig?.method || 'none'}
          style={{ width: INPUT_BOX_WIDTH_CUTOFF }}
          onChange={handleCompressionMethodChange}
          options={compressionMethodOptions}
        />
      </SettingRow>
      <SettingDivider />

      {compressionConfig?.method === 'cutoff' && <CutoffSettings />}
    </SettingGroup>
  )
}

export default CompressionSettings
