import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { Input, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = '200px'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCutoffLimitChange = (value: number | null) => {
    updateCompressionConfig({ cutoffLimit: value || undefined })
  }

  return (
    <SettingRow>
      <SettingRowTitle>
        {t('settings.websearch.compression.cutoff.limit')}
        <Tooltip title={t('settings.websearch.compression.cutoff.limit.tooltip')} placement="right">
          <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
        </Tooltip>
      </SettingRowTitle>
      <Input
        style={{ width: INPUT_BOX_WIDTH }}
        placeholder={t('settings.websearch.compression.cutoff.limit.placeholder')}
        value={compressionConfig?.cutoffLimit === undefined ? '' : compressionConfig.cutoffLimit}
        onChange={(e) => {
          const value = e.target.value
          if (value === '') {
            handleCutoffLimitChange(null)
          } else if (!isNaN(Number(value)) && Number(value) > 0) {
            handleCutoffLimitChange(Number(value))
          }
        }}
      />
    </SettingRow>
  )
}

export default CutoffSettings
