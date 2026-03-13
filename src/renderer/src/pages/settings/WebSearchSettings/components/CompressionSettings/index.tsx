import { Divider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../../hooks/useWebSearchSettings'
import { WebSearchSettingsField, WebSearchSettingsSection } from '../WebSearchSettingsLayout'
import CutoffSettings from './CutoffSettings'
import RagSettings from './RagSettings'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') },
    { value: 'rag', label: t('settings.tool.websearch.compression.method.rag') }
  ]

  const handleCompressionMethodChange = (method: string) => {
    void updateCompressionConfig({ method: method as 'none' | 'cutoff' | 'rag' })
  }

  return (
    <WebSearchSettingsSection title={t('settings.tool.websearch.compression.title')}>
      <WebSearchSettingsField title={t('settings.tool.websearch.compression.method.label')}>
        <Select value={compressionConfig?.method || 'none'} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger className="w-full lg:max-w-90">
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
      </WebSearchSettingsField>
      <Divider className="my-0" />

      {compressionConfig?.method === 'cutoff' && <CutoffSettings />}
      {compressionConfig?.method === 'rag' && <RagSettings />}
    </WebSearchSettingsSection>
  )
}

export default CompressionSettings
