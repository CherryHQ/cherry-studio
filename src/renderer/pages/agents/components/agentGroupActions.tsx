import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import { Check, Pin, PinOff, Smile, SquarePen, Trash2 } from 'lucide-react'

export interface AgentGroupActionContext {
  agentId: string
  assistantIconType: AssistantIconType
  deleteAgentDisabled?: boolean
  onEdit: (agentId: string) => void
  onDeleteAgent: (agentId: string) => void | Promise<void>
  onSetAgentIconType: (iconType: AssistantIconType) => void | Promise<void>
  onTogglePin: (agentId: string) => void | Promise<void>
  pinDisabled?: boolean
  pinned: boolean
  t: TFunction
}

export type AgentGroupAction = ResolvedAction<AgentGroupActionContext>

const agentGroupActionRegistry = createActionRegistry<AgentGroupActionContext>()
const ASSISTANT_ICON_TYPE_OPTIONS: AssistantIconType[] = ['emoji', 'model', 'none']
const ASSISTANT_ICON_TYPE_LABEL_KEYS: Record<AssistantIconType, string> = {
  emoji: 'settings.assistant.icon.type.emoji',
  model: 'settings.assistant.icon.type.model',
  none: 'settings.assistant.icon.type.none'
}

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.edit',
  run: ({ agentId, onEdit }) => {
    window.requestAnimationFrame(() => onEdit(agentId))
  }
})

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.toggle-pin',
  availability: ({ pinDisabled }) => ({ enabled: !pinDisabled }),
  run: ({ agentId, onTogglePin }) => onTogglePin(agentId)
})

for (const type of ASSISTANT_ICON_TYPE_OPTIONS) {
  agentGroupActionRegistry.registerCommand({
    id: `agent-group.set-icon-type.${type}`,
    run: ({ onSetAgentIconType }) => onSetAgentIconType(type)
  })
}

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.delete-agent',
  availability: ({ deleteAgentDisabled }) => ({ enabled: !deleteAgentDisabled }),
  run: ({ agentId, onDeleteAgent }) => onDeleteAgent(agentId)
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.edit',
  commandId: 'agent-group.edit',
  label: ({ t }) => t('agent.edit.title'),
  icon: () => <SquarePen size={14} />,
  order: 10,
  surface: 'menu'
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.toggle-pin',
  commandId: 'agent-group.toggle-pin',
  label: ({ pinned, t }) => (pinned ? t('agent.unpin.title') : t('agent.pin.title')),
  icon: ({ pinned }) => (pinned ? <PinOff size={14} /> : <Pin size={14} />),
  order: 20,
  surface: 'menu'
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.icon-type',
  label: ({ t }) => t('agent.icon.type'),
  icon: () => <Smile size={14} />,
  order: 30,
  surface: 'menu',
  children: ASSISTANT_ICON_TYPE_OPTIONS.map((type) => ({
    id: `agent-group.set-icon-type.${type}`,
    commandId: `agent-group.set-icon-type.${type}`,
    label: ({ t }) => t(ASSISTANT_ICON_TYPE_LABEL_KEYS[type]),
    icon: ({ assistantIconType }) =>
      assistantIconType === type ? <Check size={14} /> : <span className="block size-4" />,
    order: 0,
    surface: 'menu'
  }))
})

agentGroupActionRegistry.registerAction({
  id: 'agent-group.delete-agent',
  commandId: 'agent-group.delete-agent',
  label: ({ t }) => t('agent.delete.title'),
  icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
  group: 'danger',
  order: 40,
  surface: 'menu',
  danger: true
})

export function resolveAgentGroupActions(context: AgentGroupActionContext): AgentGroupAction[] {
  return agentGroupActionRegistry.resolve(context, 'menu')
}

export async function executeAgentGroupAction(
  action: AgentGroupAction,
  context: AgentGroupActionContext
): Promise<boolean> {
  return agentGroupActionRegistry.execute(action.id, context)
}
