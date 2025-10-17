import { InfoTooltip, Input } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@renderer/types'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface AdvancedSettingsPanelProps {
  newBase: KnowledgeBase
  handlers: {
    handleChunkSizeChange: (value: number | null) => void
    handleChunkOverlapChange: (value: number | null) => void
    handleThresholdChange: (value: number | null) => void
  }
}

const AdvancedSettingsPanel: React.FC<AdvancedSettingsPanelProps> = ({ newBase, handlers }) => {
  const { t } = useTranslation()
  const { handleChunkSizeChange, handleChunkOverlapChange, handleThresholdChange } = handlers

  const handleNumericInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    onChange: (value: number | null) => void,
    options: { min?: number; max?: number; allowFloat?: boolean } = {}
  ) => {
    const { value } = event.target

    if (value === '') {
      onChange(null)
      return
    }

    const parsed = options.allowFloat ? Number.parseFloat(value) : Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    let sanitized = parsed

    if (!options.allowFloat) {
      sanitized = Math.round(sanitized)
    }

    if (options.min !== undefined) {
      sanitized = Math.max(options.min, sanitized)
    }

    if (options.max !== undefined) {
      sanitized = Math.min(options.max, sanitized)
    }

    onChange(sanitized)
  }

  return (
    <div className="px-4">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('knowledge.chunk_size')}
          <InfoTooltip content={t('knowledge.chunk_size_tooltip')} placement="right" />
        </div>
        <Input
          className="w-full"
          inputMode="numeric"
          min={100}
          step={1}
          value={newBase.chunkSize ?? ''}
          placeholder={t('knowledge.chunk_size_placeholder')}
          aria-label={t('knowledge.chunk_size')}
          onChange={(event) => handleNumericInputChange(event, handleChunkSizeChange, { min: 100 })}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('knowledge.chunk_overlap')}
          <InfoTooltip content={t('knowledge.chunk_overlap_tooltip')} placement="right" />
        </div>
        <Input
          className="w-full"
          inputMode="numeric"
          min={0}
          step={1}
          value={newBase.chunkOverlap ?? ''}
          placeholder={t('knowledge.chunk_overlap_placeholder')}
          aria-label={t('knowledge.chunk_overlap')}
          onChange={(event) => handleNumericInputChange(event, handleChunkOverlapChange, { min: 0 })}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('knowledge.threshold')}
          <InfoTooltip content={t('knowledge.threshold_tooltip')} placement="right" />
        </div>
        <Input
          className="w-full"
          inputMode="decimal"
          step={0.1}
          min={0}
          max={1}
          value={newBase.threshold ?? ''}
          placeholder={t('knowledge.threshold_placeholder')}
          aria-label={t('knowledge.threshold')}
          onChange={(event) =>
            handleNumericInputChange(event, handleThresholdChange, { min: 0, max: 1, allowFloat: true })
          }
        />
      </div>

      {/* <Alert className="border border-default-200 bg-default-50 text-sm" style={{ color: 'var(--color-warning)' }}>
        <AlertDescription className="text-current">
          {t('knowledge.chunk_size_change_warning')}
        </AlertDescription>
      </Alert> */}
    </div>
  )
}

export default AdvancedSettingsPanel
