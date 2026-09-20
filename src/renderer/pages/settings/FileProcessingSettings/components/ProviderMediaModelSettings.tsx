import { useTranslation } from 'react-i18next'

import { ModelSelectorTriggerButton } from '@renderer/components/DefaultModelSelector'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isProviderMediaTranscriptionModel } from '@shared/utils/mediaTranscriptionModels'

type ProviderMediaModelSettingsProps = {
  value: string
  onChange: (value: string) => void
}

export function ProviderMediaModelSettings({ value, onChange }: ProviderMediaModelSettingsProps) {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const uniqueModelId = isUniqueModelId(value) ? value : undefined
  const { model } = useModelById(uniqueModelId)

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <SettingRow className="items-center gap-4 py-0">
        <SettingRowTitle className="w-24 shrink-0">
          {t('settings.tool.file_processing.fields.transcription_model')}
        </SettingRowTitle>
        <div className="min-w-0 flex-1">
          <ModelSelector
            multiple={false}
            selectionType="id"
            value={uniqueModelId}
            includeAgentOnlyModels
            filter={isProviderMediaTranscriptionModel}
            noneOptionLabel={t('common.none')}
            onSelect={(modelId: UniqueModelId | undefined) => onChange(modelId ?? '')}
            trigger={
              <ModelSelectorTriggerButton
                model={model}
                providers={providers}
                placeholder={t('settings.tool.file_processing.fields.transcription_model')}
              />
            }
          />
        </div>
      </SettingRow>
    </div>
  )
}
