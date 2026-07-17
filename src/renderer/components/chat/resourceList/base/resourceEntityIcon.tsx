import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { ActionDescriptor, ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { EntityAvatarIcon } from '@renderer/components/EntityAvatarIcon'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import type { EntityAvatar } from '@shared/data/types/entityAvatar'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { TFunction } from 'i18next'
import { Check } from 'lucide-react'
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

export function renderAssistantEntityIcon(
  iconType: AssistantIconType,
  assistant: { avatar: EntityAvatar; modelId?: string | null; modelName?: string | null },
  fallbackModelId?: string | null
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(assistant.modelId ?? fallbackModelId, assistant.modelName)
  if (iconType === 'model' && modelAvatarModel) return <ModelAvatar model={modelAvatarModel} size={24} />

  return <EntityAvatarIcon avatar={assistant.avatar} size={24} fontSize={14} className="mr-0" />
}

export function renderAgentEntityIcon(
  iconType: AssistantIconType,
  agent: { avatar: EntityAvatar; model?: string | null; modelName?: string | null } | undefined,
  fallbackModelId?: string | null
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(agent?.model ?? fallbackModelId, agent?.modelName)
  if (iconType === 'model' && modelAvatarModel) return <ModelAvatar model={modelAvatarModel} size={24} />

  return agent ? <EntityAvatarIcon avatar={agent.avatar} size={24} fontSize={14} className="mr-0" /> : undefined
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
