import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { MODALITY, MODEL_CAPABILITY, type Modality, type ModelCapability } from '@shared/data/types/model'

import { toggleModelValue } from './helpers'
import type { ModelMetadata } from './types'

interface ModelMetadataControlsProps {
  value: ModelMetadata
  onChange: (patch: Partial<ModelMetadata>) => void
}

const CAPABILITY_OPTIONS = [
  { value: MODEL_CAPABILITY.REASONING, label: 'models.type.reasoning' },
  { value: MODEL_CAPABILITY.FUNCTION_CALL, label: 'models.type.function_calling' },
  { value: MODEL_CAPABILITY.IMAGE_GENERATION, label: 'settings.models.add.capabilities.image_generation' },
  { value: MODEL_CAPABILITY.EMBEDDING, label: 'models.type.embedding' },
  { value: MODEL_CAPABILITY.RERANK, label: 'models.type.rerank' }
] as const

const MODALITY_OPTIONS = [
  { value: MODALITY.TEXT, label: 'models.type.text' },
  { value: MODALITY.IMAGE, label: 'models.type.image' },
  { value: MODALITY.AUDIO, label: 'models.type.audio' },
  { value: MODALITY.VIDEO, label: 'models.type.video' }
] as const

const INPUT_RECOGNITION_OPTIONS: readonly { capability: ModelCapability; modality: Modality }[] = [
  { capability: MODEL_CAPABILITY.IMAGE_RECOGNITION, modality: MODALITY.IMAGE },
  { capability: MODEL_CAPABILITY.AUDIO_RECOGNITION, modality: MODALITY.AUDIO },
  { capability: MODEL_CAPABILITY.VIDEO_RECOGNITION, modality: MODALITY.VIDEO }
]

export function ModelMetadataControls({ value, onChange }: ModelMetadataControlsProps) {
  const { t } = useTranslation()
  const inputModalities = [
    ...new Set([
      ...(value.inputModalities ?? []),
      ...INPUT_RECOGNITION_OPTIONS.filter((option) => value.capabilities.includes(option.capability)).map(
        (option) => option.modality
      )
    ])
  ]

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('settings.models.add.capabilities.label')} className="space-y-2">
        <div className={drawerClasses.fieldTitle}>{t('settings.models.add.capabilities.label')}</div>
        <div className="flex flex-wrap gap-2">
          {CAPABILITY_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={value.capabilities.includes(option.value) ? 'secondary' : 'outline'}
              aria-pressed={value.capabilities.includes(option.value)}
              onClick={() => onChange({ capabilities: toggleModelValue(value.capabilities, option.value) })}>
              {t(option.label)}
            </Button>
          ))}
        </div>
      </div>
      {(['inputModalities', 'outputModalities'] as const).map((field) => {
        const modalities = field === 'inputModalities' ? inputModalities : value.outputModalities
        const label = t(
          field === 'inputModalities'
            ? 'settings.models.add.input_modalities.label'
            : 'settings.models.add.output_modalities.label'
        )
        return (
          <div key={field} role="group" aria-label={label} className="space-y-2">
            <div className={drawerClasses.fieldTitle}>{label}</div>
            <div className="flex flex-wrap gap-2">
              {MODALITY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={modalities?.includes(option.value) ? 'secondary' : 'outline'}
                  aria-pressed={modalities?.includes(option.value) ?? false}
                  onClick={() =>
                    onChange({
                      [field]: toggleModelValue(modalities, option.value),
                      ...(field === 'inputModalities'
                        ? {
                            capabilities: value.capabilities.filter(
                              (capability) =>
                                !INPUT_RECOGNITION_OPTIONS.some((option) => option.capability === capability)
                            )
                          }
                        : {})
                    })
                  }>
                  {t(option.label)}
                </Button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
