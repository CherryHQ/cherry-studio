import { InfoTooltip, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import ModelSelector from '@renderer/components/ModelSelector'
import { isRerankModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import { Alert } from 'antd'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

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
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">
          {t('settings.tool.preprocess.title')}
          <InfoTooltip title={t('settings.tool.preprocess.tooltip')} placement="right" />
        </div>
        <Select
          value={selectedDocPreprocessProvider?.id || ''}
          onValueChange={(value) => handleDocPreprocessChange(value)}>
          <SelectTrigger className="w-full">
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
          <InfoTooltip content={t('knowledge.chunk_size_tooltip')} placement="right" />
        </div>
        <Input
          type="number"
          className="w-full"
          min={100}
          value={newBase.chunkSize?.toString() || ''}
          placeholder={t('knowledge.chunk_size_placeholder')}
          onChange={(e) => handleChunkSizeChange(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('knowledge.chunk_size')}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.chunk_overlap')}
          <InfoTooltip content={t('knowledge.chunk_overlap_tooltip')} placement="right" />
        </div>
        <Input
          type="number"
          className="w-full"
          min={0}
          value={newBase.chunkOverlap?.toString() || ''}
          placeholder={t('knowledge.chunk_overlap_placeholder')}
          onChange={(e) => handleChunkOverlapChange(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('knowledge.chunk_overlap')}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.threshold')}
          <InfoTooltip content={t('knowledge.threshold_tooltip')} placement="right" />
        </div>
        <Input
          type="number"
          className="w-full"
          step={0.1}
          min={0}
          max={1}
          value={newBase.threshold?.toString() || ''}
          placeholder={t('knowledge.threshold_placeholder')}
          onChange={(e) => handleThresholdChange(e.target.value ? Number(e.target.value) : null)}
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
