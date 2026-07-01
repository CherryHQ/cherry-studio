import { InfoTooltip, Input } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { useWebSearchPersist } from '@renderer/pages/settings/WebSearchSettings/hooks/useWebSearchPersist'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

const settingRowClassName = 'items-center justify-between gap-6 py-1'
const settingLabelClassName = 'min-w-0 flex-1'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()
  const persist = useWebSearchPersist()

  const handleCutoffLimitChange = (value: number | null) => {
    void persist(
      () => updateCompressionConfig({ cutoffLimit: value || DEFAULT_WEB_SEARCH_CUTOFF_LIMIT }),
      'Failed to save web search cutoff limit'
    )
  }

  return (
    <SettingRow className={settingRowClassName}>
      <SettingRowTitle className={settingLabelClassName}>
        {t('settings.tool.websearch.compression.cutoff.limit.label')}
        <InfoTooltip
          placement="right"
          content={t('settings.tool.websearch.compression.cutoff.limit.tooltip')}
          iconProps={{
            size: 16,
            color: 'var(--color-icon)',
            className: 'ms-1 cursor-pointer'
          }}
        />
      </SettingRowTitle>
      <div className="flex w-56 shrink-0">
        <Input
          placeholder={t('settings.tool.websearch.compression.cutoff.limit.placeholder')}
          value={compressionConfig?.cutoffLimit === undefined ? '' : compressionConfig.cutoffLimit}
          className="h-8 text-sm"
          onChange={(e) => {
            const value = e.target.value
            if (value === '') {
              handleCutoffLimitChange(DEFAULT_WEB_SEARCH_CUTOFF_LIMIT)
            } else if (!Number.isNaN(Number(value)) && Number(value) > 0) {
              handleCutoffLimitChange(Number(value))
            }
          }}
        />
      </div>
    </SettingRow>
  )
}

export default CutoffSettings
