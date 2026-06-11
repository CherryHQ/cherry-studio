import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { useWebSearchPersist } from '@renderer/pages/settings/WebSearchSettings/hooks/useWebSearchPersist'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'

const settingRowClassName = 'items-center justify-between gap-6 py-1'
const settingLabelClassName = 'min-w-0 flex-1'
const selectTriggerClassName = 'h-8 w-56 text-sm'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  const handleCompressionMethodChange = (value: 'none' | 'cutoff') => {
    void persist(
      () =>
        updateCompressionConfig({
          method: value,
          ...(value === 'cutoff'
            ? { cutoffLimit: compressionConfig?.cutoffLimit || DEFAULT_WEB_SEARCH_CUTOFF_LIMIT }
            : {})
        }),
      'Failed to save web search compression method'
    )
  }

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') }
  ]

  return (
    <>
      <SettingRow className={settingRowClassName}>
        <SettingRowTitle className={settingLabelClassName}>
          {t('settings.tool.websearch.compression.method.label')}
        </SettingRowTitle>
        <Select value={compressionConfig?.method || 'none'} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger size="sm" className={selectTriggerClassName}>
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
    </>
  )
}

export default CompressionSettings
