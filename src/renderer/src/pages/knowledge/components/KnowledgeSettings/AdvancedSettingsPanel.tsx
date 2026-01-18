import {
  Field,
  FieldGroup,
  FieldLabel,
  InfoTooltip,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import ModelSelector from '@renderer/components/ModelSelector'
import { isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SelectOption {
  value: string
  label: string
}

interface AdvancedSettingsPanelProps {
  newBase: KnowledgeBase
  selectedDocPreprocessProvider?: PreprocessProvider
  docPreprocessSelectOptions: SelectOption[]
  handlers: {
    handleChunkSizeChange: (value: number | null) => void
    handleChunkOverlapChange: (value: number | null) => void
    handleThresholdChange: (value: number | null) => void
    handleDocPreprocessChange: (value: string) => void
    handleRerankModelChange: (value: string) => void
  }
}

const AdvancedSettingsPanel: React.FC<AdvancedSettingsPanelProps> = ({
  newBase,
  selectedDocPreprocessProvider,
  docPreprocessSelectOptions,
  handlers
}) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const {
    handleChunkSizeChange,
    handleChunkOverlapChange,
    handleThresholdChange,
    handleDocPreprocessChange,
    handleRerankModelChange
  } = handlers

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="kb-preprocess">
          {t('settings.tool.preprocess.title')}
          <InfoTooltip title={t('settings.tool.preprocess.tooltip')} placement="right" />
        </FieldLabel>
        <Select
          value={selectedDocPreprocessProvider?.id || ''}
          onValueChange={(value) => handleDocPreprocessChange(value)}>
          <SelectTrigger id="kb-preprocess" className="w-full">
            <SelectValue placeholder={t('settings.tool.preprocess.provider_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {docPreprocessSelectOptions?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>
          {t('models.rerank_model')}
          <InfoTooltip title={t('models.rerank_model_tooltip')} placement="right" />
        </FieldLabel>
        <ModelSelector
          providers={providers}
          predicate={isRerankModel}
          style={{ width: '100%' }}
          value={getModelUniqId(newBase.rerankModel) || undefined}
          placeholder={t('settings.models.empty')}
          onChange={handleRerankModelChange}
          allowClear
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="kb-chunk-size">
          {t('knowledge.chunk_size')}
          <InfoTooltip content={t('knowledge.chunk_size_tooltip')} placement="right" />
        </FieldLabel>
        <Input
          id="kb-chunk-size"
          type="number"
          className="w-full rounded-2xs"
          min={100}
          value={newBase.chunkSize?.toString() || ''}
          placeholder={t('knowledge.chunk_size_placeholder')}
          onChange={(e) => handleChunkSizeChange(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('knowledge.chunk_size')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="kb-chunk-overlap">
          {t('knowledge.chunk_overlap')}
          <InfoTooltip content={t('knowledge.chunk_overlap_tooltip')} placement="right" />
        </FieldLabel>
        <Input
          id="kb-chunk-overlap"
          type="number"
          className="w-full rounded-2xs"
          min={0}
          value={newBase.chunkOverlap?.toString() || ''}
          placeholder={t('knowledge.chunk_overlap_placeholder')}
          onChange={(e) => handleChunkOverlapChange(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('knowledge.chunk_overlap')}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="kb-threshold">
          {t('knowledge.threshold')}
          <InfoTooltip content={t('knowledge.threshold_tooltip')} placement="right" />
        </FieldLabel>
        <Input
          id="kb-threshold"
          type="number"
          className="w-full rounded-2xs"
          step={0.1}
          min={0}
          max={1}
          value={newBase.threshold?.toString() || ''}
          placeholder={t('knowledge.threshold_placeholder')}
          onChange={(e) => handleThresholdChange(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('knowledge.threshold')}
        />
      </Field>

      <div className="h-8 flex flex-row items-center gap-2 border border-amber-400/40 text-amber-400 bg-amber-400/10 rounded-2xs px-2">
        <TriangleAlert size={16} className="text-amber-400" />
        {t('knowledge.chunk_size_change_warning')}
      </div>
    </FieldGroup>
  )
}

export default AdvancedSettingsPanel
