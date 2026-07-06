import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { ActionDescriptor, ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_EMOJI } from '@shared/data/presets/defaultAssistant'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { TFunction } from 'i18next'
import { Bot, Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { buildResolvedResourceEntityMenuAction } from './resourceEntityActions'

export const RESOURCE_ICON_TYPE_OPTIONS: readonly AssistantIconType[] = ['emoji', 'model', 'none']

const RESOURCE_ICON_TYPE_LABEL_KEYS: Record<AssistantIconType, string> = {
  emoji: 'settings.assistant.icon.type.emoji',
  model: 'settings.assistant.icon.type.model',
  none: 'settings.assistant.icon.type.none'
}

function buildModelAvatarModel(uniqueModelId: unknown, modelName: string | null | undefined) {
  if (!isUniqueModelId(uniqueModelId)) return undefined

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return {
    id: modelId,
    name: modelName || modelId,
    providerId
  }
}

function renderFallbackAssistantIcon(emoji?: string | null) {
  return emoji ? (
    <EmojiIcon emoji={emoji} size={24} fontSize={14} className="mr-0" />
  ) : (
    <span className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent">
      <Bot size={14} />
    </span>
  )
}

export function renderAssistantEntityIcon(
  iconType: AssistantIconType,
  assistant: { emoji?: string | null; modelId?: string | null; modelName?: string | null },
  fallbackModelId?: string | null
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(assistant.modelId ?? fallbackModelId, assistant.modelName)
  if (iconType === 'model' && modelAvatarModel) return <ModelAvatar model={modelAvatarModel} size={24} />

  return renderFallbackAssistantIcon(assistant.emoji)
}

export function renderAgentEntityIcon(
  iconType: AssistantIconType,
  agent: { configuration?: AgentConfiguration; model?: string | null; modelName?: string | null } | undefined,
  fallbackModelId?: string | null
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(agent?.model ?? fallbackModelId, agent?.modelName)
  if (iconType === 'model' && modelAvatarModel) return <ModelAvatar model={modelAvatarModel} size={24} />

  return (
    <EmojiIcon
      emoji={getAgentAvatarFromConfiguration(agent?.configuration) || DEFAULT_ASSISTANT_EMOJI}
      size={24}
      fontSize={14}
      className="mr-0"
    />
  )
}

export function buildResolvedIconTypeActions(
  parentActionId: string,
  currentIconType: AssistantIconType,
  t: TFunction
): ResolvedAction[] {
  return RESOURCE_ICON_TYPE_OPTIONS.map((type) => ({
    id: `${parentActionId}.${type}`,
    label: t(RESOURCE_ICON_TYPE_LABEL_KEYS[type]),
    icon: currentIconType === type ? <Check size={14} /> : <span className="block size-4" />,
    order: 0,
    danger: false,
    availability: { visible: true, enabled: true },
    children: []
  }))
}

export function buildResolvedIconTypeMenuAction(
  parentActionId: string,
  label: ReactNode,
  icon: ReactNode,
  order: number,
  currentIconType: AssistantIconType,
  t: TFunction
): ResolvedAction {
  return buildResolvedResourceEntityMenuAction({
    id: parentActionId,
    label,
    icon,
    order,
    children: buildResolvedIconTypeActions(parentActionId, currentIconType, t)
  })
}

export function buildIconTypeActionDescriptors<TContext extends { assistantIconType: AssistantIconType; t: TFunction }>(
  commandPrefix: string
): ActionDescriptor<TContext>[] {
  return RESOURCE_ICON_TYPE_OPTIONS.map((type) => ({
    id: `${commandPrefix}.${type}`,
    commandId: `${commandPrefix}.${type}`,
    label: ({ t }) => t(RESOURCE_ICON_TYPE_LABEL_KEYS[type]),
    icon: ({ assistantIconType }) =>
      assistantIconType === type ? <Check size={14} /> : <span className="block size-4" />,
    order: 0,
    surface: 'menu'
  }))
}
