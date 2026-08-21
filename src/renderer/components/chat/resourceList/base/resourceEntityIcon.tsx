import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { AvatarIcon } from '@renderer/components/AvatarIcon'
import type { ActionDescriptor, ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import type { AvatarValue } from '@shared/data/types/avatar'
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

const RESOURCE_ICON_SIZE = 24

function renderAvatarIcon(avatar: AvatarValue, size: number) {
  return <AvatarIcon avatar={avatar} size={size} fontSize={Math.round(size * 0.58)} className="mr-0" />
}

/**
 * @param size - Rendered icon size; the sidebar renders smaller rows than the rails.
 */
export function renderAssistantEntityIcon(
  iconType: AssistantIconType,
  assistant: { avatar: AvatarValue; modelId?: string | null; modelName?: string | null },
  fallbackModelId?: string | null,
  size: number = RESOURCE_ICON_SIZE
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(assistant.modelId ?? fallbackModelId, assistant.modelName)
  if (iconType === 'model' && modelAvatarModel) {
    return <ModelAvatar model={modelAvatarModel} size={size} className="border border-border-subtle" />
  }

  return renderAvatarIcon(assistant.avatar, size)
}

/**
 * @param size - Rendered icon size; the sidebar renders smaller rows than the rails.
 */
export function renderAgentEntityIcon(
  iconType: AssistantIconType,
  agent: { avatar: AvatarValue; model?: string | null; modelName?: string | null } | undefined,
  fallbackModelId?: string | null,
  size: number = RESOURCE_ICON_SIZE
) {
  if (iconType === 'none') return undefined

  const modelAvatarModel = buildModelAvatarModel(agent?.model ?? fallbackModelId, agent?.modelName)
  if (iconType === 'model' && modelAvatarModel) return <ModelAvatar model={modelAvatarModel} size={size} />

  return agent ? renderAvatarIcon(agent.avatar, size) : undefined
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
