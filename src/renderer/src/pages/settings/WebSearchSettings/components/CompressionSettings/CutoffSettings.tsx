import {
  Divider,
  InfoTooltip,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { useWebSearchSettings } from '../../hooks/useWebSearchSettings'
import { WebSearchSettingsField } from '../WebSearchSettingsLayout'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCutoffLimitChange = (value?: number) => {
    void updateCompressionConfig({ cutoffLimit: value })
  }

  const handleCutoffUnitChange = (unit: string) => {
    void updateCompressionConfig({ cutoffUnit: unit as 'char' | 'token' })
  }

  const unitOptions = [
    { value: 'char', label: t('settings.tool.websearch.compression.cutoff.unit.char') },
    { value: 'token', label: t('settings.tool.websearch.compression.cutoff.unit.token') }
  ]

  return (
    <>
      <WebSearchSettingsField
        title={
          <>
            {t('settings.tool.websearch.compression.cutoff.limit.label')}
            <InfoTooltip
              placement="right"
              content={t('settings.tool.websearch.compression.cutoff.limit.tooltip')}
              iconProps={{
                size: 16,
                color: 'var(--color-icon)',
                className: 'cursor-pointer'
              }}
            />
          </>
        }>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Input
            type="number"
            min={1}
            className="sm:max-w-34"
            placeholder={t('settings.tool.websearch.compression.cutoff.limit.placeholder')}
            value={compressionConfig?.cutoffLimit === undefined ? '' : compressionConfig.cutoffLimit}
            onChange={(e) => {
              const value = e.target.value.trim()
              if (value === '') {
                handleCutoffLimitChange(undefined)
                return
              }

              const nextValue = Number(value)
              if (Number.isFinite(nextValue) && nextValue > 0) {
                handleCutoffLimitChange(nextValue)
              }
            }}
          />
          <Select value={compressionConfig?.cutoffUnit || 'char'} onValueChange={handleCutoffUnitChange}>
            <SelectTrigger className="w-full sm:max-w-40">
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
        </div>
      </WebSearchSettingsField>
      <Divider className="my-0" />
    </>
  )
}

export default CutoffSettings
