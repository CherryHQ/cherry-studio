import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'
import RagSettings from './RagSettings'

const INPUT_BOX_WIDTH_CUTOFF = '200px'
const INPUT_BOX_WIDTH_RAG = 'min(350px, 60%)'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compression, setCompression } = useWebSearchSettings()

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') },
    { value: 'rag', label: t('settings.tool.websearch.compression.method.rag') }
  ]

  const handleCompressionMethodChange = (method: 'none' | 'cutoff' | 'rag') => {
    setCompression({ ...compression, method })
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select
          value={compression?.method || 'none'}
          style={{ width: compression?.method === 'rag' ? INPUT_BOX_WIDTH_RAG : INPUT_BOX_WIDTH_CUTOFF }}
          onChange={handleCompressionMethodChange}
          options={compressionMethodOptions}
        />
      </SettingRow>
      <SettingDivider />

      {compression?.method === 'cutoff' && <CutoffSettings />}
      {compression?.method === 'rag' && <RagSettings />}
    </SettingGroup>
  )
}

export default CompressionSettings
