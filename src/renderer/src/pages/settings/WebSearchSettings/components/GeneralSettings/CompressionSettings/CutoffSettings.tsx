import { InfoTooltip, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useCutoffCompression } from '@renderer/hooks/useWebSearch'
import type { WebSearchCompressionCutoffUnit } from '@shared/data/preference/preferenceTypes'
import { useTranslation } from 'react-i18next'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { cutoffLimit, setCutoffLimit, cutoffUnit, setCutoffUnit } = useCutoffCompression()

  const handleCutoffLimitChange = (value: number | null) => {
    setCutoffLimit(value)
  }

  const handleCutoffUnitChange = (unit: WebSearchCompressionCutoffUnit) => {
    setCutoffUnit(unit)
  }

  return (
    <div className="flex flex-row justify-between">
      <div className="flex flex-row items-center gap-1">
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
      </div>
      <div className="flex w-1/3">
        <Input
          className="w-3/5 rounded-3xs rounded-r-none border-r-0 focus-visible:relative focus-visible:z-10"
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
        <Select value={cutoffUnit} onValueChange={handleCutoffUnitChange}>
          <SelectTrigger className="w-2/5 rounded-l-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="char">{t('settings.tool.websearch.compression.cutoff.unit.char')}</SelectItem>
            <SelectItem value="token">{t('settings.tool.websearch.compression.cutoff.unit.token')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default CutoffSettings
