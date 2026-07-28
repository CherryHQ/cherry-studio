import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  buildIconTypeActionDescriptors,
  buildResourceEntityIconTypeActionDescriptor,
  buildResourceEntityMenuActionDescriptor,
  RESOURCE_ICON_TYPE_OPTIONS
} from '@renderer/components/chat/resourceList/base'
import type { AssistantIconType } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import { Pin, PinOff, Smile, SquarePen, Trash2 } from 'lucide-react'

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

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.edit',
  run: ({ agentId, onEdit }) => {
    onEdit(agentId)
  }
})

agentGroupActionRegistry.registerCommand({
  id: 'agent-group.toggle-pin',
  availability: ({ pinDisabled }) => ({ enabled: !pinDisabled }),
  run: ({ agentId, onTogglePin }) => onTogglePin(agentId)
})

for (const type of RESOURCE_ICON_TYPE_OPTIONS) {
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

agentGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'agent-group.edit',
    commandId: 'agent-group.edit',
    label: ({ t }) => t('agent.edit.title'),
    icon: () => <SquarePen size={14} />,
    order: 10
  })
)

agentGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'agent-group.toggle-pin',
    commandId: 'agent-group.toggle-pin',
    label: ({ pinned, t }) => (pinned ? t('agent.unpin.title') : t('agent.pin.title')),
    icon: ({ pinned }) => (pinned ? <PinOff size={14} /> : <Pin size={14} />),
    order: 20
  })
)

agentGroupActionRegistry.registerAction(
  buildResourceEntityIconTypeActionDescriptor({
    id: 'agent-group.icon-type',
    label: ({ t }) => t('agent.icon.type'),
    icon: () => <Smile size={14} />,
    order: 30,
    children: buildIconTypeActionDescriptors<AgentGroupActionContext>('agent-group.set-icon-type')
  })
)

agentGroupActionRegistry.registerAction(
  buildResourceEntityMenuActionDescriptor({
    id: 'agent-group.delete-agent',
    commandId: 'agent-group.delete-agent',
    label: ({ t }) => t('agent.delete.title'),
    icon: () => <Trash2 size={14} className="lucide-custom text-destructive" />,
    group: 'danger',
    order: 40,
    danger: true
  })
)

export function resolveAgentGroupActions(context: AgentGroupActionContext): AgentGroupAction[] {
  return agentGroupActionRegistry.resolve(context, 'menu')
}

export async function executeAgentGroupAction(
  action: AgentGroupAction,
  context: AgentGroupActionContext
): Promise<boolean> {
  return agentGroupActionRegistry.execute(action.id, context)
}
