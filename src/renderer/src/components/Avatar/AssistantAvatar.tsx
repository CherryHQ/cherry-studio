import EmojiIcon from '@renderer/components/EmojiIcon'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import type { Assistant } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import type { FC } from 'react'
import { useMemo } from 'react'

import ModelAvatar from './ModelAvatar'

interface AssistantAvatarProps {
  assistant: Assistant
  size?: number
  className?: string
}

const AssistantAvatar: FC<AssistantAvatarProps> = ({ assistant, size = 24, className }) => {
  const { assistantIconType } = useSettings()
  const { model } = useAssistant(assistant.id)
  const v1Model = useMemo(() => (model ? fromSharedModel(model) : undefined), [model])

  const assistantName = useMemo(() => assistant.name || '', [assistant.name])

  if (assistantIconType === 'model') {
    return <ModelAvatar model={v1Model} size={size} className={className} />
  }

  if (assistantIconType === 'emoji') {
    return <EmojiIcon emoji={assistant.emoji || getLeadingEmoji(assistantName)} size={size} className={className} />
  }

  return null
}

export default AssistantAvatar
