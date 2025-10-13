import { InfoTooltip } from '@cherrystudio/ui'
import { Input, Select, SelectItem, Slider } from '@heroui/react'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

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
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">{t('common.name')}</div>
        <Input
          data-testid="name-input"
          size="sm"
          type="text"
          variant="bordered"
          placeholder={t('common.name')}
          value={newBase.name}
          onChange={(e) => setNewBase((prev) => ({ ...prev, name: e.target.value }))}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('settings.tool.preprocess.title')}
          <InfoTooltip content={t('settings.tool.preprocess.tooltip')} placement="right" />
        </div>
        <Select
          data-testid="preprocess-select"
          className="w-full"
          variant="bordered"
          size="sm"
          placeholder={t('settings.tool.preprocess.provider_placeholder')}
          selectedKeys={selectedDocPreprocessProvider ? new Set([selectedDocPreprocessProvider.id]) : new Set()}
          isClearable
          onSelectionChange={(keys) => {
            if (keys === 'all') {
              handleDocPreprocessChange('')
              return
            }
            const [key] = Array.from(keys)
            handleDocPreprocessChange((key as string) || '')
          }}>
          {docPreprocessSelectOptions.map((option) => (
            <SelectItem key={option.value}>{option.label}</SelectItem>
          ))}
        </Select>
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
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
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.dimensions')}
          <InfoTooltip content={t('knowledge.dimensions_size_tooltip')} placement="right" />
        </div>
        <InputEmbeddingDimension
          value={newBase.dimensions}
          onChange={handleDimensionChange}
          model={newBase.model}
          disabled={!newBase.model}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
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
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
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
      </SettingsItem>
    </SettingsPanel>
  )
}

export default GeneralSettingsPanel
