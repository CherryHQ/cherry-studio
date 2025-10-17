import { InfoTooltip, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { Slider } from '@heroui/react'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import { useTranslation } from 'react-i18next'

type DocPreprocessSelectOption = {
  value: string
  label: string
}

interface GeneralSettingsPanelProps {
  newBase: KnowledgeBase
  setNewBase: React.Dispatch<React.SetStateAction<KnowledgeBase>>
  selectedDocPreprocessProvider?: PreprocessProvider
  docPreprocessSelectOptions: DocPreprocessSelectOption[]
  handlers: {
    handleEmbeddingModelChange: (value: string) => void
    handleDimensionChange: (value: number | null) => void
    handleRerankModelChange: (value: string) => void
    handleDocPreprocessChange: (value: string) => void
  }
}

const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({
  newBase,
  setNewBase,
  selectedDocPreprocessProvider,
  docPreprocessSelectOptions,
  handlers
}) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { handleEmbeddingModelChange, handleDimensionChange, handleRerankModelChange, handleDocPreprocessChange } =
    handlers

  return (
    <div className="px-4">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">{t('common.name')}</div>
        <Input
          data-testid="name-input"
          type="text"
          placeholder={t('common.name')}
          value={newBase.name}
          onChange={(e) => setNewBase((prev) => ({ ...prev, name: e.target.value }))}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('settings.tool.preprocess.title')}
          <InfoTooltip content={t('settings.tool.preprocess.tooltip')} placement="right" />
        </div>
        <Select
          value={selectedDocPreprocessProvider?.id}
          onValueChange={(value) => {
            if (value === '__none__') {
              handleDocPreprocessChange('')
              return
            }
            handleDocPreprocessChange(value)
          }}>
          <SelectTrigger data-testid="preprocess-select" className="w-full" size="sm">
            <SelectValue placeholder={t('settings.tool.preprocess.provider_placeholder')} />
          </SelectTrigger>
          <SelectContent className="w-full">
            <SelectItem value="__none__">{t('common.none')}</SelectItem>
            {docPreprocessSelectOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('models.embedding_model')}
          <InfoTooltip content={t('models.embedding_model_tooltip')} placement="right" />
        </div>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          style={{ width: '100%' }}
          placeholder={t('settings.models.empty')}
          value={getModelUniqId(newBase.model)}
          onChange={handleEmbeddingModelChange}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('knowledge.dimensions')}
          <InfoTooltip content={t('knowledge.dimensions_size_tooltip')} placement="right" />
        </div>
        <InputEmbeddingDimension
          value={newBase.dimensions}
          onChange={handleDimensionChange}
          model={newBase.model}
          disabled={!newBase.model}
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('models.rerank_model')}
          <InfoTooltip content={t('models.rerank_model_tooltip')} placement="right" />
        </div>
        <ModelSelector
          providers={providers}
          predicate={isRerankModel}
          style={{ width: '100%' }}
          value={getModelUniqId(newBase.rerankModel) || undefined}
          placeholder={t('settings.models.empty')}
          onChange={handleRerankModelChange}
          allowClear
        />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {t('knowledge.document_count')}
          <InfoTooltip content={t('knowledge.document_count_help')} placement="right" />
        </div>
        <Slider
          data-testid="document-count-slider"
          size="sm"
          className="w-full"
          minValue={1}
          maxValue={50}
          step={1}
          value={newBase.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT}
          marks={[
            { value: 1, label: '1' },
            { value: 6, label: t('knowledge.document_count_default') },
            { value: 30, label: '30' },
            { value: 50, label: '50' }
          ]}
          showTooltip={true}
          onChange={(value) =>
            setNewBase((prev) => ({ ...prev, documentCount: Array.isArray(value) ? value[0] : value }))
          }
        />
      </div>
    </div>
  )
}

export default GeneralSettingsPanel
