import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '@cherrystudio/ui'
import { SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { useWebSearchPersist } from '@renderer/pages/settings/WebSearchSettings/hooks/useWebSearchPersist'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'

import CutoffSettings from './CutoffSettings'

const settingRowClassName = 'min-h-8 items-center justify-between gap-3'
const settingLabelClassName = 'min-w-0 flex-1'
type CompressionMethod = 'none' | 'cutoff'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  const handleCompressionMethodChange = (value: CompressionMethod) => {
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

  const compressionMethodOptions: Array<{ value: CompressionMethod; label: string }> = [
    { value: 'none', label: t('settings.tool.websearch.compression.method.none') },
    { value: 'cutoff', label: t('settings.tool.websearch.compression.method.cutoff') }
  ]

  return (
    <>
      <SettingRow className={settingRowClassName}>
        <SettingRowTitle className={settingLabelClassName}>
          {t('settings.tool.websearch.compression.method.label')}
        </SettingRowTitle>
        <SegmentedControl<CompressionMethod>
          size="sm"
          className="h-8 shrink-0 [&_[role=radio]]:h-6.5"
          aria-label={t('settings.tool.websearch.compression.method.label')}
          value={compressionConfig?.method || 'none'}
          options={compressionMethodOptions}
          onValueChange={handleCompressionMethodChange}
        />
      </SettingRow>
      {compressionConfig?.method === 'cutoff' && <CutoffSettings />}
    </>
  )
}

export default CompressionSettings
