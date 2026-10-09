import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { SettingDescription, SettingGroup, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import { isVideoVisionSelectableModel } from '@shared/utils/model'

interface VideoVisionModelSettingsProps {
  modelId: string | null
  onModelChange: (modelId: UniqueModelId | null) => Promise<void>
}

export function VideoVisionModelSettings({ modelId, onModelChange }: VideoVisionModelSettingsProps) {
  const { t } = useTranslation()
  const { providers } = useProviders({ enabled: true })
  const selectedModelId = isUniqueModelId(modelId) ? modelId : undefined
  const { model } = useModelById(selectedModelId)

  const handleSelect = useCallback(
    (selectedModel: Model | undefined) => {
      void onModelChange(selectedModel?.id ?? null)
    },
    [onModelChange]
  )

  return (
    <SettingGroup>
      <SettingRow className="flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{t('settings.tool.file_processing.video_vision.title')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.tool.file_processing.video_vision.description')}
          </SettingDescription>
        </div>
        <div className="flex w-full min-w-0 shrink-0 items-center sm:w-56">
          <DefaultModelSelector
            model={model}
            providers={providers}
            placeholder={t('settings.tool.file_processing.video_vision.title')}
            filter={isVideoVisionSelectableModel}
            noneOptionLabel={t('common.none')}
            onSelect={handleSelect}
          />
        </div>
      </SettingRow>
    </SettingGroup>
  )
}
