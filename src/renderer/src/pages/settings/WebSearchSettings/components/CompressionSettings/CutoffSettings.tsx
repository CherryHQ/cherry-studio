import { InfoTooltip, Input } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { useTranslation } from 'react-i18next'

import { Field } from '../Field'

const CutoffSettings = () => {
  const { t } = useTranslation()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()

  const handleCutoffLimitChange = (value: number | null) => {
    void updateCompressionConfig({ cutoffLimit: value || DEFAULT_WEB_SEARCH_CUTOFF_LIMIT })
  }

  return (
    <Field
      label={t('settings.tool.websearch.compression.cutoff.limit.label')}
      help={
        <InfoTooltip
          placement="right"
          content={t('settings.tool.websearch.compression.cutoff.limit.tooltip')}
          iconProps={{ size: 10, color: 'currentColor', className: 'cursor-pointer text-muted-foreground/25' }}
        />
      }>
      <div className="flex w-full">
        <Input
          className="h-7 border-border/30 bg-foreground/[0.03] text-xs leading-tight"
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
    </Field>
  )
}

export default CutoffSettings
