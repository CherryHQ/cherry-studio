import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { Input, Select, Space, Tooltip } from 'antd'
import { ChevronDown, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = '200px'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCutoffLimitChange = (value: number | null) => {
    updateCompressionConfig({ cutoffLimit: value || undefined })
  }

  const handleCutoffUnitChange = (unit: 'char' | 'token') => {
    updateCompressionConfig({ cutoffUnit: unit })
  }

  const unitOptions = [
    { value: 'char', label: t('settings.tool.websearch.compression.cutoff.unit.char') },
    { value: 'token', label: t('settings.tool.websearch.compression.cutoff.unit.token') }
  ]

  return (
    <SettingRow>
      <SettingRowTitle>
        {t('settings.tool.websearch.compression.cutoff.limit.label')}
        <Tooltip title={t('settings.tool.websearch.compression.cutoff.limit.tooltip')} placement="right">
          <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
        </Tooltip>
      </SettingRowTitle>
      <Space.Compact style={{ width: INPUT_BOX_WIDTH }}>
        <Input
          style={{ maxWidth: '60%' }}
          placeholder={t('settings.tool.websearch.compression.cutoff.limit.placeholder')}
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
        <Select
          value={compressionConfig?.cutoffUnit || 'char'}
          style={{ minWidth: '40%' }}
          onChange={handleCutoffUnitChange}
          options={unitOptions}
          suffixIcon={<ChevronDown size={16} color="var(--color-border)" />}
        />
      </Space.Compact>
    </SettingRow>
  )
}

export default CutoffSettings
