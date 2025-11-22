import ModelSelector from '@renderer/components/ModelSelector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import type { SelectProps } from 'antd'
import { Alert, InputNumber, Select } from 'antd'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

interface AdvancedSettingsPanelProps {
  newBase: KnowledgeBase
  selectedDocPreprocessProvider?: PreprocessProvider
  docPreprocessSelectOptions: SelectProps['options']
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
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">
          {t('settings.tool.preprocess.title')}
          <InfoTooltip title={t('settings.tool.preprocess.tooltip')} placement="right" />
        </div>
        <Select
          value={selectedDocPreprocessProvider?.id}
          style={{ width: '100%' }}
          onChange={handleDocPreprocessChange}
          placeholder={t('settings.tool.preprocess.provider_placeholder')}
          options={docPreprocessSelectOptions}
          allowClear
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('models.rerank_model')}
          <InfoTooltip title={t('models.rerank_model_tooltip')} placement="right" />
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
          {t('knowledge.chunk_size')}
          <InfoTooltip title={t('knowledge.chunk_size_tooltip')} placement="right" />
        </div>
        <InputNumber
          style={{ width: '100%' }}
          min={100}
          value={newBase.chunkSize}
          placeholder={t('knowledge.chunk_size_placeholder')}
          onChange={handleChunkSizeChange}
          aria-label={t('knowledge.chunk_size')}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.chunk_overlap')}
          <InfoTooltip title={t('knowledge.chunk_overlap_tooltip')} placement="right" />
        </div>
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          value={newBase.chunkOverlap}
          placeholder={t('knowledge.chunk_overlap_placeholder')}
          onChange={handleChunkOverlapChange}
          aria-label={t('knowledge.chunk_overlap')}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.threshold')}
          <InfoTooltip title={t('knowledge.threshold_tooltip')} placement="right" />
        </div>
        <InputNumber
          style={{ width: '100%' }}
          step={0.1}
          min={0}
          max={1}
          value={newBase.threshold}
          placeholder={t('knowledge.threshold_placeholder')}
          onChange={handleThresholdChange}
          aria-label={t('knowledge.threshold')}
        />
      </SettingsItem>

      <Alert
        message={t('knowledge.chunk_size_change_warning')}
        type="warning"
        showIcon
        icon={<TriangleAlert size={16} className="lucide-custom" />}
      />
    </SettingsPanel>
  )
}

export default AdvancedSettingsPanel
