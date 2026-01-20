import { InfoTooltip } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import type { WebSearchCompressionCutoffUnit } from '@shared/data/preference/preferenceTypes'
import { Input, Select, Space } from 'antd'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const INPUT_BOX_WIDTH = '200px'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { cutoffLimit, setCutoffLimit, cutoffUnit, setCutoffUnit } = useWebSearchSettings()

  const handleCutoffLimitChange = (value: number | null) => {
    setCutoffLimit(value)
  }

  const handleCutoffUnitChange = (unit: WebSearchCompressionCutoffUnit) => {
    setCutoffUnit(unit)
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
          value={cutoffLimit === null ? '' : cutoffLimit}
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
          value={cutoffUnit}
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
