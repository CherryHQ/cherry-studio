import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import type { WebSearchCompressionMethod } from '@shared/data/preference/preferenceTypes'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'
import RagSettings from './RagSettings'

const INPUT_BOX_WIDTH_CUTOFF = '200px'
const INPUT_BOX_WIDTH_RAG = 'min(350px, 60%)'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionMethod, setCompressionMethod } = useWebSearchSettings()

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') },
    { value: 'rag', label: t('settings.tool.websearch.compression.method.rag') }
  ]

  const handleCompressionMethodChange = (method: WebSearchCompressionMethod) => {
    setCompressionMethod(method)
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select
          value={compressionMethod}
          style={{ width: compressionMethod === 'rag' ? INPUT_BOX_WIDTH_RAG : INPUT_BOX_WIDTH_CUTOFF }}
          onChange={handleCompressionMethodChange}
          options={compressionMethodOptions}
        />
      </SettingRow>
      <SettingDivider />

      {compressionMethod === 'cutoff' && <CutoffSettings />}
      {compressionMethod === 'rag' && <RagSettings />}
    </SettingGroup>
  )
}

export default CompressionSettings
