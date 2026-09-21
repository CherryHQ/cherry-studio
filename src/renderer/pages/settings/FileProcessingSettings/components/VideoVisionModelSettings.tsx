import { useTranslation } from 'react-i18next'

import { ModelSelectorTriggerButton } from '@renderer/components/DefaultModelSelector'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { SettingDescription, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useDefaultModel, useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isVideoVisionSelectableModel } from '@shared/utils/nativeFileSupport'

import { useFileProcessingPreferences } from '../hooks/useFileProcessingPreferences'

/**
 * Independent video-vision model picker for AV hybrid preprocessing.
 * Vision = scenes/people/actions; OCR remains the configured image_to_text processor.
 */
export function VideoVisionModelSettings() {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { videoVisionModel, setVideoVisionModel } = useDefaultModel()
  const uniqueModelId = videoVisionModel?.id
  const { model } = useModelById(isUniqueModelId(uniqueModelId) ? uniqueModelId : undefined)
  const provider = providers.find((item) => item.id === model?.providerId)
  const { defaultImageProcessor } = useFileProcessingPreferences()

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <SettingRow className="items-start gap-4 py-0">
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{t('settings.models.video_vision_model')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.models.video_vision_model_description')}
          </SettingDescription>
        </div>
        <div className="w-[340px] shrink-0">
          <ModelSelector
            multiple={false}
            selectionType="id"
            value={uniqueModelId}
            filter={isVideoVisionSelectableModel}
            noneOptionLabel={t('common.none')}
            onSelect={(modelId: UniqueModelId | undefined) =>
              setVideoVisionModel(modelId ? { id: modelId } : undefined)
            }
            trigger={
              <ModelSelectorTriggerButton
                model={model}
                providers={providers}
                placeholder={t('settings.models.video_vision_model')}
              />
            }
          />
        </div>
      </SettingRow>
      {provider ? (
        <SettingDescription className="leading-5 text-foreground-tertiary">
          {t('settings.tool.file_processing.video_vision_provider_hint', {
            provider: provider.name,
            destination:
              Object.values(provider.endpointConfigs ?? {})
                .map((endpoint) => endpoint?.baseUrl)
                .find(Boolean) || provider.name
          })}
        </SettingDescription>
      ) : null}
      <SettingDescription className="leading-5 text-foreground-tertiary">
        {t('settings.tool.file_processing.video_vision_privacy_hint')}
      </SettingDescription>
      <SettingDescription className="leading-5 text-foreground-tertiary">
        {t('settings.tool.file_processing.video_ocr_processor_hint', {
          processor: defaultImageProcessor ?? t('common.none')
        })}
      </SettingDescription>
    </div>
  )
}
