import { InfoTooltip, Input } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = '200px'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCutoffLimitChange = (value: number | null) => {
    void updateCompressionConfig({ cutoffLimit: value || DEFAULT_WEB_SEARCH_CUTOFF_LIMIT })
  }

  return (
    <SettingRow className="py-2">
      <SettingRowTitle>
        {t('settings.tool.websearch.compression.cutoff.limit.label')}
        <InfoTooltip
          placement="right"
          content={t('settings.tool.websearch.compression.cutoff.limit.tooltip')}
          iconProps={{
            size: 16,
            color: 'var(--color-icon)',
            className: 'ml-1 cursor-pointer'
          }}
        />
      </SettingRowTitle>
      <div className="flex" style={{ width: INPUT_BOX_WIDTH }}>
        <Input
          placeholder={t('settings.tool.websearch.compression.cutoff.limit.placeholder')}
          value={compressionConfig?.cutoffLimit === undefined ? '' : compressionConfig.cutoffLimit}
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
