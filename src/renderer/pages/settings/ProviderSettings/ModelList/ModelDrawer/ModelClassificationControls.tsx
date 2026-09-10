import { Button } from '@cherrystudio/ui'
import { drawerClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { MODALITY, MODEL_CAPABILITY, type ModelOperationCapability } from '@shared/data/types/model'
import {
  ArrowUpDown,
  Boxes,
  BrainCircuit,
  Ear,
  Eye,
  Image,
  Mic,
  RotateCcw,
  Type,
  Video,
  Volume2,
  Wrench
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  EditableModelOperationCapability,
  ModelCapabilityToggle,
  ModelClassificationState,
  ModelInputModality
} from './types'

interface ModelClassificationControlsProps {
  value: ModelClassificationState
  hasChanges?: boolean
  onOperationCapabilityToggle: (capability: EditableModelOperationCapability) => void
  onCapabilityToggle: (capability: ModelCapabilityToggle) => void
  onInputModalityToggle: (modality: ModelInputModality) => void
  onReset?: () => void
}

interface ClassificationOption<T extends string> {
  value: T
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

const MODEL_OPERATION_OPTIONS: readonly (ClassificationOption<ModelOperationCapability> & { editable: boolean })[] = [
  { value: MODEL_CAPABILITY.TEXT_GENERATION, label: 'models.type.text', icon: Type, editable: true },
  { value: MODEL_CAPABILITY.IMAGE_GENERATION, label: 'models.type.image', icon: Image, editable: true },
  { value: MODEL_CAPABILITY.EMBEDDING, label: 'models.type.embedding', icon: Boxes, editable: true },
  { value: MODEL_CAPABILITY.RERANK, label: 'models.type.rerank', icon: ArrowUpDown, editable: true },
  { value: MODEL_CAPABILITY.AUDIO_TRANSCRIPT, label: 'models.type.audio', icon: Mic, editable: false },
  { value: MODEL_CAPABILITY.AUDIO_GENERATION, label: 'models.type.audio', icon: Volume2, editable: false },
  { value: MODEL_CAPABILITY.VIDEO_GENERATION, label: 'models.type.video', icon: Video, editable: false }
]

const MODEL_CAPABILITY_OPTIONS: readonly ClassificationOption<ModelCapabilityToggle>[] = [
  { value: MODEL_CAPABILITY.REASONING, label: 'models.type.reasoning', icon: BrainCircuit },
  { value: MODEL_CAPABILITY.FUNCTION_CALL, label: 'models.type.function_calling', icon: Wrench }
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
  disabled = false,
  onClick
}: {
  option: ClassificationOption<T>
  selected: boolean
  disabled?: boolean
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
      disabled={disabled}
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
  onOperationCapabilityToggle,
  onCapabilityToggle,
  onInputModalityToggle,
  onReset
}: ModelClassificationControlsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="space-y-2" role="group" aria-label={t('settings.models.add.operations.label')}>
        <div className="flex items-center justify-between gap-3">
          <div className={drawerClasses.fieldTitle}>{t('settings.models.add.operations.label')}</div>
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
          {MODEL_OPERATION_OPTIONS.filter(
            (option) => option.editable || value.operationCapabilities.has(option.value)
          ).map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              selected={value.operationCapabilities.has(option.value)}
              disabled={!option.editable}
              onClick={() => onOperationCapabilityToggle(option.value as EditableModelOperationCapability)}
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
