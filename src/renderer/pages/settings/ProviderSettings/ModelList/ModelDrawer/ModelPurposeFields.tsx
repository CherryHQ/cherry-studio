import {
  FieldLegend,
  FieldSet,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelChatEndpointType, ModelPurpose } from './modelPurpose'

interface ModelPurposeFieldsProps {
  purpose: ModelPurpose
  chatEndpointType: ModelChatEndpointType
  chatEndpointTypes: ModelChatEndpointType[]
  onPurposeChange: (purpose: ModelPurpose) => void
  onChatEndpointTypeChange: (endpointType: ModelChatEndpointType) => void
}

const PURPOSES: ModelPurpose[] = ['chat', 'image-generation', 'image-edit']

const ENDPOINT_LABEL_KEYS: Record<ModelChatEndpointType, string> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'settings.provider.more_endpoints.openai_chat',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'settings.provider.more_endpoints.openai_responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'settings.provider.more_endpoints.anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'settings.provider.more_endpoints.gemini'
}

const PURPOSE_LABEL_KEYS: Record<ModelPurpose, { label: string; description: string }> = {
  chat: {
    label: 'settings.models.add.purpose.chat.label',
    description: 'settings.models.add.purpose.chat.description'
  },
  'image-generation': {
    label: 'settings.models.add.purpose.image_generation.label',
    description: 'settings.models.add.purpose.image_generation.description'
  },
  'image-edit': {
    label: 'settings.models.add.purpose.image_edit.label',
    description: 'settings.models.add.purpose.image_edit.description'
  }
}

export function ModelPurposeFields({
  purpose,
  chatEndpointType,
  chatEndpointTypes,
  onPurposeChange,
  onChatEndpointTypeChange
}: ModelPurposeFieldsProps) {
  const { t } = useTranslation()
  const uid = useId()
  const descriptionId = `${uid}-purpose-description`

  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0 text-[13px] text-foreground">
        {t('settings.models.add.purpose.label')}
      </FieldLegend>
      <p id={descriptionId} className="text-foreground-muted text-xs">
        {t('settings.models.add.purpose.description')}
      </p>
      <RadioGroup
        value={purpose}
        aria-describedby={descriptionId}
        onValueChange={(value) => onPurposeChange(value as ModelPurpose)}>
        {PURPOSES.map((option) => {
          const optionId = `${uid}-${option}`
          const label = PURPOSE_LABEL_KEYS[option]
          return (
            <label
              key={option}
              htmlFor={optionId}
              className={cn(
                'flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border border-border-subtle px-3 py-2.5',
                'transition-[background-color,border-color,box-shadow] duration-150 hover:bg-accent',
                'focus-within:ring-2 focus-within:ring-ring',
                purpose === option && 'border-primary bg-accent'
              )}>
              <RadioGroupItem id={optionId} value={option} className="mt-0.5" />
              <span>
                <span className="block font-medium text-[13px] text-foreground">{t(label.label)}</span>
                <span className="mt-0.5 block text-foreground-muted text-xs">{t(label.description)}</span>
              </span>
            </label>
          )
        })}
      </RadioGroup>

      {purpose === 'chat' && chatEndpointTypes.length > 1 && (
        <div className="mt-1 flex flex-col gap-2">
          <label htmlFor={`${uid}-chat-protocol`} className="font-medium text-[13px] text-foreground">
            {t('settings.models.add.purpose.chat_protocol')}
          </label>
          <Select
            value={chatEndpointType}
            onValueChange={(value) => onChatEndpointTypeChange(value as ModelChatEndpointType)}>
            <SelectTrigger id={`${uid}-chat-protocol`} className="min-h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chatEndpointTypes.map((endpointType) => (
                <SelectItem key={endpointType} value={endpointType}>
                  {t(ENDPOINT_LABEL_KEYS[endpointType])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </FieldSet>
  )
}
