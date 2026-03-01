import { Field, FieldGroup, FieldLabel, InfoTooltip, Input, Slider } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel } from '@renderer/config/models'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, Provider } from '@renderer/types'
import { useTranslation } from 'react-i18next'

interface GeneralSettingsPanelProps {
  newBase: KnowledgeBase
  providers: Provider[]
  setNewBase: React.Dispatch<React.SetStateAction<KnowledgeBase>>
  handlers: {
    handleEmbeddingModelChange: (value: string) => void
    handleDimensionChange: (value: number | null) => void
  }
}

const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({ newBase, providers, setNewBase, handlers }) => {
  const { t } = useTranslation()
  const { handleEmbeddingModelChange, handleDimensionChange } = handlers

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="kb-name">{t('common.name')}</FieldLabel>
        <Input
          id="kb-name"
          className="rounded-2xs"
          placeholder={t('common.name')}
          value={newBase.name}
          onChange={(e) => setNewBase((prev) => ({ ...prev, name: e.target.value }))}
        />
      </Field>

      <Field>
        <FieldLabel>
          {t('models.embedding_model')}
          <InfoTooltip content={t('models.embedding_model_tooltip')} placement="right" />
        </FieldLabel>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          style={{ width: '100%' }}
          placeholder={t('settings.models.empty')}
          value={getModelUniqId(newBase.model)}
          onChange={handleEmbeddingModelChange}
        />
      </Field>

      <Field>
        <FieldLabel>
          {t('knowledge.dimensions')}
          <InfoTooltip content={t('knowledge.dimensions_size_tooltip')} placement="right" />
        </FieldLabel>
        <InputEmbeddingDimension
          value={newBase.dimensions}
          onChange={handleDimensionChange}
          model={newBase.model}
          disabled={!newBase.model}
        />
      </Field>

      <Field className="gap-4">
        <FieldLabel htmlFor="kb-document-count">
          {t('knowledge.document_count')}
          <InfoTooltip content={t('knowledge.document_count_help')} placement="right" />
        </FieldLabel>
        <Slider
          id="kb-document-count"
          min={1}
          max={50}
          step={1}
          showValueLabel
          value={[newBase.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT]}
          marks={[
            { value: 1, label: '1' },
            { value: 6, label: t('knowledge.document_count_default') },
            { value: 30, label: '30' },
            { value: 50, label: '50' }
          ]}
          onValueChange={(values) => setNewBase((prev) => ({ ...prev, documentCount: values[0] }))}
        />
      </Field>
    </FieldGroup>
  )
}

export default GeneralSettingsPanel
