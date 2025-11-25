import { InfoTooltip, Slider } from '@cherrystudio/ui'
import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { Input } from 'antd'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

interface GeneralSettingsPanelProps {
  newBase: KnowledgeBase
  setNewBase: React.Dispatch<React.SetStateAction<KnowledgeBase>>
  handlers: {
    handleEmbeddingModelChange: (value: string) => void
    handleDimensionChange: (value: number | null) => void
  }
}

const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({ newBase, setNewBase, handlers }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { handleEmbeddingModelChange, handleDimensionChange } = handlers

  return (
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">{t('common.name')}</div>
        <Input
          placeholder={t('common.name')}
          value={newBase.name}
          onChange={(e) => setNewBase((prev) => ({ ...prev, name: e.target.value }))}
        />
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
          {t('knowledge.document_count')}
          <InfoTooltip content={t('knowledge.document_count_help')} placement="right" />
        </div>
        <Slider
          className="w-[97%]"
          min={1}
          max={50}
          step={1}
          value={[newBase.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT]}
          marks={[
            { value: 1, label: '1' },
            { value: 6, label: t('knowledge.document_count_default') },
            { value: 30, label: '30' },
            { value: 50, label: '50' }
          ]}
          onValueChange={(values) => setNewBase((prev) => ({ ...prev, documentCount: values[0] }))}
          showValueLabel
        />
      </SettingsItem>
    </SettingsPanel>
  )
}

export default GeneralSettingsPanel
