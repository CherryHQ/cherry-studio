import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { ModelChatEndpointType } from './modelPurpose'

const ENDPOINT_LABEL_KEYS: Record<ModelChatEndpointType, string> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'settings.provider.more_endpoints.openai_chat',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'settings.provider.more_endpoints.openai_responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'settings.provider.more_endpoints.anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'settings.provider.more_endpoints.gemini'
}

export function ModelChatProtocolFields({
  chatEndpointType,
  chatEndpointTypes,
  onChatEndpointTypeChange
}: {
  chatEndpointType: ModelChatEndpointType
  chatEndpointTypes: ModelChatEndpointType[]
  onChatEndpointTypeChange: (endpointType: ModelChatEndpointType) => void
}) {
  const { t } = useTranslation()
  const uid = useId()
  if (chatEndpointTypes.length < 2) return null
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Label htmlFor={`${uid}-chat-protocol`} className="text-[13px] text-foreground">
        {t('settings.models.add.purpose.chat_protocol')}
      </Label>
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
  )
}
