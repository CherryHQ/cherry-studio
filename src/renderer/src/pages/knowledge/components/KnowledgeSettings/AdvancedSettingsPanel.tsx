import { Alert, NumberInput } from '@heroui/react'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import type { KnowledgeBase } from '@renderer/types'
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
          <InfoTooltip title={t('knowledge.chunk_size_tooltip')} placement="right" />
        </div>
        <NumberInput
          className="w-full"
          variant="bordered"
          size="sm"
          minValue={100}
          value={newBase.chunkSize ?? undefined}
          placeholder={t('knowledge.chunk_size_placeholder')}
          aria-label={t('knowledge.chunk_size')}
          onValueChange={(value) => {
            const nextValue = value === undefined || Number.isNaN(value) ? null : value
            handleChunkSizeChange(nextValue)
          }}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.chunk_overlap')}
          <InfoTooltip title={t('knowledge.chunk_overlap_tooltip')} placement="right" />
        </div>
        <NumberInput
          className="w-full"
          variant="bordered"
          size="sm"
          minValue={0}
          value={newBase.chunkOverlap ?? undefined}
          placeholder={t('knowledge.chunk_overlap_placeholder')}
          aria-label={t('knowledge.chunk_overlap')}
          onValueChange={(value) => {
            const nextValue = value === undefined || Number.isNaN(value) ? null : value
            handleChunkOverlapChange(nextValue)
          }}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.threshold')}
          <InfoTooltip title={t('knowledge.threshold_tooltip')} placement="right" />
        </div>
        <NumberInput
          className="w-full"
          variant="bordered"
          size="sm"
          step={0.1}
          minValue={0}
          maxValue={1}
          value={newBase.threshold ?? undefined}
          placeholder={t('knowledge.threshold_placeholder')}
          aria-label={t('knowledge.threshold')}
          onValueChange={(value) => {
            const nextValue = value === undefined || Number.isNaN(value) ? null : value
            handleThresholdChange(nextValue)
          }}
        />
      </SettingsItem>

      <Alert
      className='p-0'
      radius='sm'
        hideIconWrapper
        color="warning"
        variant="bordered"
        title={t('knowledge.chunk_size_change_warning')}
      />
    </SettingsPanel>
  )
}

export default AdvancedSettingsPanel
