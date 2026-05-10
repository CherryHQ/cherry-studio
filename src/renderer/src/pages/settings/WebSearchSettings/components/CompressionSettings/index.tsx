import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

import { Field } from '../Field'
import { SettingsSection } from '../SettingsSection'
import CutoffSettings from './CutoffSettings'

const CompressionSettings = () => {
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
    <SettingsSection title={t('settings.tool.websearch.compression.title')}>
      <Field label={t('settings.tool.websearch.compression.method.label')}>
        <Select value={compressionConfig?.method || 'none'} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger className="h-7 w-full rounded-full bg-foreground/[0.06] text-xs leading-tight" size="sm">
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
      </Field>
      {compressionConfig?.method === 'cutoff' && <CutoffSettings />}
    </SettingsSection>
  )
}

export default CompressionSettings
