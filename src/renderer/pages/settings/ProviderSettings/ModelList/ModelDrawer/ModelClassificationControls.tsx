import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import { ArrowUpDown, Boxes, BrainCircuit, Ear, Eye, Globe2, Image, RotateCcw, Type, Video, Wrench } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelCapabilityToggle, ModelClassificationState, ModelInputModality, ModelPrimaryType } from './types'

interface ModelClassificationControlsProps {
  value: ModelClassificationState
  hasChanges?: boolean
  onPrimaryTypeChange: (type: ModelPrimaryType) => void
  onCapabilityToggle: (capability: ModelCapabilityToggle) => void
  onInputModalityToggle: (modality: ModelInputModality) => void
  onReset?: () => void
}

interface ClassificationOption<T extends string> {
  value: T
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

const MODEL_TYPE_OPTIONS: readonly ClassificationOption<ModelPrimaryType>[] = [
  { value: 'text', label: 'models.type.text', icon: Type },
  { value: 'image', label: 'models.type.image', icon: Image },
  { value: 'embedding', label: 'models.type.embedding', icon: Boxes },
  { value: 'rerank', label: 'models.type.rerank', icon: ArrowUpDown }
]

const MODEL_CAPABILITY_OPTIONS: readonly ClassificationOption<ModelCapabilityToggle>[] = [
  { value: MODEL_CAPABILITY.REASONING, label: 'models.type.reasoning', icon: BrainCircuit },
  { value: MODEL_CAPABILITY.FUNCTION_CALL, label: 'models.type.function_calling', icon: Wrench },
  { value: MODEL_CAPABILITY.WEB_SEARCH, label: 'models.type.websearch', icon: Globe2 }
]

const INPUT_MODALITY_OPTIONS: readonly ClassificationOption<ModelInputModality>[] = [
  { value: MODALITY.IMAGE, label: 'models.type.vision', icon: Eye },
  { value: MODALITY.AUDIO, label: 'models.type.audio', icon: Ear },
  { value: MODALITY.VIDEO, label: 'models.type.video', icon: Video }
]

const optionButtonClassName = 'h-7 min-h-7 gap-1.5 rounded-md px-2.5 text-xs font-normal shadow-none [&_svg]:size-3.5'

function OptionButton<T extends string>({
  option,
  selected,
  onClick
}: {
  option: ClassificationOption<T>
  selected: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const Icon = option.icon

  return (
    <Button
      type="button"
      variant={selected ? 'secondary' : 'outline'}
      size="sm"
      aria-pressed={selected}
      className={cn(optionButtonClassName, selected && 'border border-border text-foreground')}
      onClick={onClick}>
      <Icon aria-hidden />
      {t(option.label)}
    </Button>
  )
}

export function ModelClassificationControls({
  value,
  hasChanges = false,
  onPrimaryTypeChange,
  onCapabilityToggle,
  onInputModalityToggle,
  onReset
}: ModelClassificationControlsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="space-y-2" role="group" aria-label={t('settings.models.add.model_type.label')}>
        <div className="flex items-center justify-between gap-3">
          <div className={drawerClasses.fieldTitle}>{t('settings.models.add.model_type.label')}</div>
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('size-7', !hasChanges && 'invisible')}
              aria-label={t('common.reset')}
              aria-hidden={!hasChanges}
              tabIndex={hasChanges ? undefined : -1}
              onClick={onReset}>
              <RotateCcw aria-hidden className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {MODEL_TYPE_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              selected={value.primaryType === option.value}
              onClick={() => onPrimaryTypeChange(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2" role="group" aria-label={t('settings.models.add.capabilities.label')}>
        <div className={drawerClasses.fieldTitle}>{t('settings.models.add.capabilities.label')}</div>
        <div className="flex flex-wrap items-center gap-2">
          {MODEL_CAPABILITY_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              selected={value.capabilities.has(option.value)}
              onClick={() => onCapabilityToggle(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2" role="group" aria-label={t('settings.models.add.input_modalities.label')}>
        <div className={drawerClasses.fieldTitle}>{t('settings.models.add.input_modalities.label')}</div>
        <div className="flex flex-wrap items-center gap-2">
          {INPUT_MODALITY_OPTIONS.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              selected={value.inputModalities.has(option.value)}
              onClick={() => onInputModalityToggle(option.value)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
