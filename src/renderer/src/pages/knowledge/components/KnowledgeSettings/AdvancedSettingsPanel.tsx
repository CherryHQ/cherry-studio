import { InfoTooltip } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@renderer/types'
import { Alert, InputNumber } from 'antd'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

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

  return (
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.chunk_size')}
          <InfoTooltip content={t('knowledge.chunk_size_tooltip')} placement="right" />
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
          <InfoTooltip content={t('knowledge.chunk_overlap_tooltip')} placement="right" />
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
          <InfoTooltip content={t('knowledge.threshold_tooltip')} placement="right" />
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
