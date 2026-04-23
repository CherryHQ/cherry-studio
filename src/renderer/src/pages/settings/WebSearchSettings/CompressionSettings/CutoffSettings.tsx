import { InfoTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import { Input, Space } from 'antd'
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
          onValueChange={(value) => handleCutoffUnitChange(value as 'char' | 'token')}>
          <SelectTrigger className="min-w-[40%] rounded-l-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {unitOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Space.Compact>
    </SettingRow>
  )
}

export default CutoffSettings
